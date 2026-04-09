#!/bin/bash
# ================================================================
# Pathfinder Startup Script
# ================================================================
# Starts all Pathfinder services for the consolidated architecture:
#   1. Combined server (port 3000) — handles everything: static files,
#      data, artifacts, citations, briefs, backup
#   2. MCP server (port 3847) — optional, for Claude Code stdio mode only
#
# Usage:
#   ./start.sh          Start all services
#   ./start.sh stop     Stop all services
#   ./start.sh status   Check if services are running
#   ./start.sh restart  Stop then start
#
# Uses tsx to run TypeScript directly (no tsc build needed).
# ================================================================

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$PROJECT_ROOT/.pids"
LOG_DIR="$PROJECT_ROOT/.logs"

HTTP_PORT=3000
MCP_ARTIFACTS_PORT=3847

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ================================================================
# HELPERS
# ================================================================

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
  mkdir -p "$HOME/.pathfinder/data"
  mkdir -p "$HOME/.pathfinder/backups"
  mkdir -p "$HOME/.pathfinder/artifacts"
}

log_info()  { echo -e "${BLUE}[Pathfinder]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[Pathfinder]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[Pathfinder]${NC} $1"; }
log_error() { echo -e "${RED}[Pathfinder]${NC} $1"; }

is_running() {
  local pid_file="$PID_DIR/$1.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    rm -f "$pid_file"
  fi
  return 1
}

wait_for_port() {
  local port=$1
  local max_attempts=30
  local attempt=0
  while [ $attempt -lt $max_attempts ]; do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$port" 2>/dev/null | grep -qE "200|404|405"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  return 1
}

kill_port() {
  local port=$1
  lsof -ti :$port 2>/dev/null | xargs kill -9 2>/dev/null || true
}

# ================================================================
# START SERVICES
# ================================================================

start_http() {
  if is_running "http"; then
    log_warn "HTTP server already running (PID $(cat $PID_DIR/http.pid))"
    return 0
  fi

  # Kill anything already on the port (don't let old processes block us)
  kill_port "$HTTP_PORT" 2>/dev/null
  sleep 0.5

  log_info "Starting combined server (static files + data bridge) on port $HTTP_PORT..."

  # Combined Node.js server: serves static files AND handles /data/* API endpoints.
  # Falls back to Python http.server if Node.js is not available.
  if command -v node >/dev/null 2>&1 && [ -f "$PROJECT_ROOT/server.cjs" ]; then
    BRIDGE_PORT="$HTTP_PORT" SERVE_DIR="$PROJECT_ROOT" node "$PROJECT_ROOT/server.cjs" > "$LOG_DIR/http.log" 2>&1 &
  else
    log_warn "Node.js not found — falling back to Python (no data persistence)"
    python3 -m http.server "$HTTP_PORT" --directory "$PROJECT_ROOT" > "$LOG_DIR/http.log" 2>&1 &
  fi
  local pid=$!
  echo "$pid" > "$PID_DIR/http.pid"

  if wait_for_port "$HTTP_PORT"; then
    log_ok "Server running → http://localhost:$HTTP_PORT/modules/dashboard/index.html (PID $pid)"
  else
    log_error "Server failed to start. Check $LOG_DIR/http.log"
    rm -f "$PID_DIR/http.pid"
    return 1
  fi
}


start_mcp_artifacts() {
  if is_running "mcp-artifacts"; then
    log_warn "MCP server already running (PID $(cat $PID_DIR/mcp-artifacts.pid))"
    return 0
  fi

  local MCP_SERVER_DIR="$PROJECT_ROOT/mcp-server"

  # Check if MCP server directory and compiled output exist
  if [ ! -d "$MCP_SERVER_DIR" ]; then
    log_warn "MCP server not found at $MCP_SERVER_DIR — skipping"
    return 0
  fi

  # Install deps if needed
  if [ ! -d "$MCP_SERVER_DIR/node_modules" ]; then
    log_info "Installing MCP dependencies..."
    cd "$MCP_SERVER_DIR"
    if ! npm install 2>&1 | tail -3; then
      log_warn "MCP npm install failed — skipping"
      cd "$PROJECT_ROOT"
      return 0
    fi
    cd "$PROJECT_ROOT"
  fi

  # Build if needed
  if [ ! -d "$MCP_SERVER_DIR/dist" ]; then
    log_info "Building MCP server..."
    cd "$MCP_SERVER_DIR"
    if ! npm run build 2>&1 | tail -3; then
      log_warn "MCP build failed — skipping"
      cd "$PROJECT_ROOT"
      return 0
    fi
    cd "$PROJECT_ROOT"
  fi

  kill_port "$MCP_ARTIFACTS_PORT" 2>/dev/null
  sleep 0.5

  log_info "Starting MCP server on port $MCP_ARTIFACTS_PORT (Claude Code stdio mode)..."
  node "$MCP_SERVER_DIR/dist/index.js" --http > "$LOG_DIR/mcp-artifacts.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_DIR/mcp-artifacts.pid"

  if wait_for_port "$MCP_ARTIFACTS_PORT"; then
    log_ok "MCP server running → http://localhost:$MCP_ARTIFACTS_PORT (PID $pid)"
  else
    log_warn "MCP server failed to start (check $LOG_DIR/mcp-artifacts.log)"
    rm -f "$PID_DIR/mcp-artifacts.pid"
    return 0
  fi
}

start_all() {
  ensure_dirs
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  Pathfinder — Starting services${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Start combined server (static files + data bridge on one port)
  start_http

  # Start MCP server for Claude Code stdio mode
  start_mcp_artifacts

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Ready${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${GREEN}App Dashboard:${NC}"
  echo -e "    ${BLUE}http://localhost:$HTTP_PORT/modules/dashboard/index.html${NC}"
  echo ""
  if is_running "mcp-artifacts"; then
    echo -e "  ${GREEN}MCP Server (Claude Code):${NC}"
    echo -e "    ${BLUE}http://localhost:$MCP_ARTIFACTS_PORT${NC}"
    echo ""
  fi
  echo -e "  ${GREEN}Commands:${NC}"
  echo -e "    ${YELLOW}./start.sh stop${NC}     — Stop all services"
  echo -e "    ${YELLOW}./start.sh status${NC}   — Check service status"
  echo -e "    ${YELLOW}./start.sh restart${NC}  — Restart all services"
  echo ""
  echo -e "  ${BLUE}Logs: $LOG_DIR/${NC}"
  echo ""
}

# ================================================================
# STOP SERVICES
# ================================================================

stop_service() {
  local name=$1
  local pid_file="$PID_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      sleep 0.5
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
      log_ok "Stopped $name (PID $pid)"
    else
      log_warn "$name was not running (stale PID $pid)"
    fi
    rm -f "$pid_file"
  else
    log_warn "$name is not running"
  fi
}

stop_all() {
  echo ""
  log_info "Stopping all services..."
  stop_service "http"
  stop_service "mcp-artifacts"
  # Also kill any orphaned processes on our ports
  kill_port "$HTTP_PORT"
  kill_port "$MCP_ARTIFACTS_PORT"
  echo ""
}

# ================================================================
# STATUS CHECK
# ================================================================

status_all() {
  echo ""
  echo -e "${BLUE}Pathfinder Service Status${NC}"
  echo "─────────────────────────────────────"

  if is_running "http"; then
    echo -e "  Combined Server (port $HTTP_PORT):${GREEN}● running${NC} (PID $(cat $PID_DIR/http.pid))"
  else
    echo -e "  Combined Server (port $HTTP_PORT):${RED}○ stopped${NC}"
  fi

  if is_running "mcp-artifacts"; then
    echo -e "  MCP Server (port $MCP_ARTIFACTS_PORT):  ${GREEN}● running${NC} (PID $(cat $PID_DIR/mcp-artifacts.pid))"
    local mcp_health=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$MCP_ARTIFACTS_PORT/api/health" 2>/dev/null)
    if [ "$mcp_health" = "200" ]; then
      echo -e "  MCP health:                   ${GREEN}● healthy${NC}"
    else
      echo -e "  MCP health:                   ${YELLOW}● degraded (HTTP $mcp_health)${NC}"
    fi
  else
    echo -e "  MCP Server (port $MCP_ARTIFACTS_PORT):  ${RED}○ stopped${NC}"
  fi

  local data_count=$(ls "$HOME/.pathfinder/data/" 2>/dev/null | wc -l | tr -d ' ')
  echo -e "  Data keys:                    ${BLUE}$data_count files${NC} in ~/.pathfinder/data/"

  echo "─────────────────────────────────────"
  echo ""
}

# ================================================================
# MAIN
# ================================================================

case "${1:-start}" in
  start)   start_all ;;
  stop)    stop_all ;;
  restart) stop_all; start_all ;;
  status)  status_all ;;
  *)       echo "Usage: $0 {start|stop|restart|status}" ; exit 1 ;;
esac
