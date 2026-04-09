# Pathfinder

A local-data-first job search copilot that runs entirely on your machine.

## What is Pathfinder?

Pathfinder is a privacy-focused job search management tool designed to live on your computer. It runs entirely locally with no cloud services, no accounts, no tracking—your data stays yours. Use it to manage your job pipeline, score opportunities, research companies and roles, and tailor your resume all from one dashboard.

## Features

**Dashboard & Pipeline Overview** — See your application status at a glance and access quick actions for your next steps.

**Pipeline Tracker** — Kanban board for organizing your applications through statuses: leads, applied, interviewing, negotiating, and offers. Drag to update, click for details.

**Job Feed with 7-Dimension Scoring** — Add or import job listings and score them across title fit, network connectivity, domain alignment, experience level match, company appeal, compensation, and location preference. Sort and filter to find your best opportunities.

**Research Brief Generator** — AI-powered templates for researching companies and roles. Quickly compile what you need to know before reaching out or interviewing.

**Resume Tailor** — Keyword-matching tools and bullet bank to customize your resume for each role. Upload your resume, add job descriptions, and get suggestions for stronger alignment.

**Built-in Data Backup & Restore** — Export your entire data to JSON and restore it anytime. No vendor lock-in.

**Command Palette (Cmd+K)** — Quick keyboard navigation across all modules and actions.

## Quick Start

```bash
git clone https://github.com/YOUR_USERNAME/pathfinder.git
cd pathfinder
npm install
node server.cjs
# Open http://localhost:3000
```

On first run with no data, seed data will be loaded automatically so you can explore the app immediately.

## Architecture

Pathfinder is built on simplicity: a single Node.js server (server.cjs) that serves static HTML modules and provides a REST API for data persistence. No frameworks, no build step. Data is stored in `.pathfinder-data/` as JSON files that sync with your browser's localStorage, ensuring fast local access and reliable persistence.

## Modules

| Module | Purpose |
|--------|---------|
| Dashboard | Pipeline overview and quick actions |
| Pipeline | Kanban board for application tracking |
| Job Feed | Listing management with multi-dimension scoring |
| Research Brief | Company and role research template generator |
| Resume Tailor | Keyword matching and resume customization |

## Configuration

All preferences are set directly in the app via the Job Feed preferences panel. Customize your scoring weights, location preferences, and compensation ranges to match your priorities. You can also import your LinkedIn network for enhanced network-based scoring of opportunities.

## Data Privacy

All data is stored locally in `.pathfinder-data/`. Nothing leaves your machine. No analytics, no telemetry, no cloud sync, no third-party integrations. Your data is yours alone.

## Tech Stack

**Backend:** Node.js (zero framework dependencies for the server)

**Frontend:** Vanilla JavaScript + CSS custom properties

**Storage:** localStorage + file-based persistence in `.pathfinder-data/`

## Contributing

We welcome pull requests. For major changes, please open an issue first to discuss your approach.

## License

MIT
