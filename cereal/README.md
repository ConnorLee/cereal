# Cereal

**Build everything. Lose no context.**

Cereal is a local-first home for people building several things at once. It answers three questions
for each project: what am I building, where did I leave off, and what should I work on next. It reads
the folders you approve, their Git history, and your Claude Code and Codex session logs — read-only —
and keeps a source-linked context record per project, so switching never means re-explaining one.

## Get the Mac app

Download [Cereal.dmg](https://github.com/ConnorLee/cereal/releases/latest/download/Cereal.dmg), open it and drag **Cereal** to Applications. Open Cereal and it
suggests what you've been working on: the repositories your Claude Code and Codex sessions ran in this week
and the recent ones in your code folders (`~/Developer`, `~/Code`, `~/Projects` and the like). Tick them and
choose **Add**. Or drag project folders onto its window or Dock icon, or choose them with **Add a Project
Folder…** (⌘O); a folder that holds several repositories, like `~/Developer`, is offered one project each.
macOS asks once whether Cereal may read a protected folder and remembers the answer; suggesting never asks,
because Cereal doesn't look inside Documents, Desktop or iCloud until you add something there. Closing the
window keeps Cereal in the menu bar so the morning briefing still goes out; turn on **Open at Login** there.
Just looking? [Try the demo](https://cereal.work/demo.html) with sample projects first.

The app bundles Node, so there is nothing else to install. It needs a Mac with Apple silicon and macOS 13
or later. It's signed with a Developer ID and notarized by Apple, so it opens like any other Mac app.

Build it yourself with `npm run desktop` (needs Xcode's command-line tools): it writes
`desktop/dist/Cereal.app` and `desktop/dist/Cereal.dmg`, under the hardened runtime. With a **Developer ID
Application** certificate in your keychain it signs with it, then notarizes and staples the app and the disk
image so macOS opens the download without warnings. Notarizing needs credentials stored once, easiest with an
App Store Connect team API key (Users and Access › Integrations, Developer role):
`xcrun notarytool store-credentials cereal-notary --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER-ID`.
Without a Developer ID the build is signed ad hoc and the first open needs Open Anyway.
The app keeps its data in the same place as the command-line version, so don't run both at once.

## Run it from source

```sh
cd cereal
cp projects.example.json "$HOME/Library/Application Support/Cereal/projects.json"   # then edit it
npm start            # http://127.0.0.1:4317 — Node 22+, nothing to install
npm test             # unit, engine and privacy tests on synthetic fixtures
```

Or skip the file: on a fresh install, Cereal opens on **Add a project**. Give it a name and a folder,
approve what it finds, and it indexes them. Either way, the list of projects stays on your Mac.

## Try the demo

```sh
npm run demo         # builds cereal/demo/: static files, no server, sample projects only
```

The demo runs Cereal's real engine over three generated sample projects (Git history, docs, decisions,
Claude Code and Codex sessions, one blocked folder) and ships the results with the real interface.
Open a project, switch to another, and a moment later an agent in the first project finishes; jump back
to it. Your place is kept in the browser. Host `demo/` anywhere that serves static files.

The same build writes `demo/get.html` (the download page), `demo/Cereal.zip` (the app, with a
double-clickable `Start Cereal.command`) and links them from the demo bar. `npm run package` refreshes
just the zip. The zip contains source only: no data folder, no demo and no tests.

## What it does

- **Discovery by Git evidence.** Checkouts are grouped by their common Git directory, so a repository
  with twenty worktrees is one source, not twenty projects. The main source is the matching repository
  with the strongest evidence: a project marker such as an `.xcodeproj`, the most checkouts, recent
  commits. Nothing is read until you approve it; **Choose a folder…** opens the macOS folder picker.
- **Read-only indexing.** Tracked docs from the most active checkout and the main checkout, plus docs
  changed this week in other checkouts. Decision records (`D01 — …`, `ADR-012`), handoffs, open
  questions, and Git state. Git runs with `GIT_OPTIONAL_LOCKS=0`, so even `git status` never rewrites
  an index. Design files are listed by name only. `.env*`, keys, certificates, provisioning profiles
  and any file containing a credential pattern are skipped.
- **Claude Code and Codex sessions** from `~/.claude/projects` and `~/.codex/sessions`. A session is
  linked to a project when it ran inside an approved checkout, or, marked *inferred*, when its file
  paths point overwhelmingly into one project. Everything else stays unassigned. Commits an agent
  claims are checked against Git.
- **Pick up where you left off.** Each project opens on the thing you were doing, with direct actions
  to reopen it. Below that: what's next, and what changed since your last visit. Every fact says where
  it came from — Git, an agent, a recorded decision, a document, you, or an inference — and opens its source.
- **Switching** with the project pills or `⌘K`. Leaving a project saves its tab, scroll position and
  open item; coming back restores them.
- **Notifications.** When an agent finishes in a project you aren't looking at, Cereal offers to jump
  back to it with that session open.

## Look and feel

Each project reads as a short story in large type: what an agent finished, where you left off, what
needs your call. Point at a sentence to bring it forward and see where it came from; click to open it.
The interface uses Aeonik Pro when it's installed on your Mac (it isn't bundled) and the system font
otherwise. Each project's own colour carries its identity; the rest of the interface stays neutral.

## Morning edition, covers and brands

- **Morning edition.** The top of the portfolio is a short daily paper: what moved overnight, one
  headline per project in plain words, and folded sections for market context and why now (lines your
  own documents say about TAM, market size or timing), what's new in the product, and how it got here.
  **Done reading** folds it away for the day.
- **Covers.** Each project's header is its most recently committed product shot (screenshots, mockups,
  store shots; never icons or test snapshots), as phones in device frames or a full image fading into
  the page. It updates when a newer one is committed. Pin your own with `"cover"` in `projects.json`;
  a newer product shot still takes over automatically.
- **Brand.** Cereal uses a project's real app icon or logo, a wordmark file if the repo has one, or a
  typeface you name in `projects.json` (`"brand": { "font": "…" }`, installed on your Mac).
- **Code** in documents, commits and resume commands is syntax-coloured in Catppuccin Mocha; long lists,
  code blocks and document sections fold.
- **Context panel and tabs** use Cereal's component kit (`public/ui.js`, `public/ui.css`): shadcn/ui's
  Tabs, Card, Badge, Accordion and Table, ported to plain template functions so Cereal stays
  dependency-free.

## Morning Briefing

*Start your day with Cereal.* One email each morning across the projects you choose: what moved since the
last briefing, where you left off, what needs you, and one thing to focus on. Open **Morning Briefing**
from Home to preview tomorrow's email, read past ones and set up delivery.

- **What it says.** Built from the same indexed facts as the rest of Cereal and compared with the
  snapshot kept from the last briefing that was delivered. Commits found in Git are marked *In Git*;
  agent results are *Agent reported* or *Unverified* until someone looks. A quiet night is reported as
  quiet. Nothing is written by a model.
- **Off by default.** Turning it on needs a verified address (a six-digit code). Choose the time, time
  zone (daylight saving is handled), every day or weekdays, which projects appear, and how much detail.
- **Once per morning.** Each morning is a delivery window claimed in `briefing.json` under a lock, so
  the app and the background scheduler can both run without sending twice. Failed sends retry after 5,
  15 and 45 minutes; a send that never reports back is not repeated. Asleep at 8:00? It goes out when
  the Mac wakes, until early afternoon.
- **Scheduler.** It runs while Cereal is open. For mornings when it isn't,
  `npm run briefing:launchd -- --install` installs a launchd agent that runs `npm run briefing:send`
  every ten minutes (`npm run briefing:launchd` alone only prints it).
- **Sending.** With no provider configured, emails are written to `outbox/` in Cereal's data folder and
  never leave the Mac. To send for real, open **Morning Briefing → Delivery** and paste a Resend API key
  with a sending address (an address on a domain verified with SPF and DKIM at Resend, or
  `onboarding@resend.dev` to email yourself). The key is saved in `mail.json` in Cereal's data folder,
  readable only by you, and is never shown again or included in an email. `CEREAL_MAIL_PROVIDER`,
  `RESEND_API_KEY` and `CEREAL_MAIL_FROM` still work and take precedence over the saved key. Sending
  through a provider gives it the summary text.
- **What leaves the Mac.** Titles and short summaries only: never files, document text, agent
  conversations, file paths or anything that looks like a secret. *Headlines only* drops names too.
  Links in the email are opaque (`#/briefing/open/<id>/<n>`) and resolve inside Cereal.
- **In the news.** Optional: up to three recent headlines per project about what it's building, for
  example a competitor launching a feature you're working on. Each project has up to four short topics
  (suggested from its description, editable in Morning Briefing → Delivery, or set with `"news": [...]` in
  `projects.json`). Cereal searches Google News and Hacker News for those words only; nothing from the
  project goes with them. A headline is kept only if it contains a topic's words close together, product
  news ranks first, each item says which topic it matched, and nothing shown before is repeated. Off by default.
- **Pause and unsubscribe** links are signed; opening one shows a confirmation page, and confirming acts.
  One-click `List-Unsubscribe` headers are added when Cereal is reachable over https (`CEREAL_APP_URL`).

## Starting Cereal so it can read your folders

The Mac app asks for access itself. From source: macOS decides which apps may read `~/Documents` and `~/Desktop`. Double-click
`scripts/start-cereal.command` (or run `npm start` in Terminal). The first time, macOS asks whether
Terminal may read those folders; allow it and Cereal can read the projects you approved there.

## Privacy

- Everything stays on this Mac, in `~/Library/Application Support/Cereal/`. Nothing is uploaded.
- When macOS blocks a folder, its indexed contents are dropped. Cereal keeps only how many documents it
  had indexed and when, so the project reads as *blocked*, not *empty*.
- **What Cereal keeps** shows exactly what is stored for a project, and **Forget** deletes everything
  derived from it. Folder approvals stay, so you can re-index later.
- **Brief with Claude** is opt-in (`ANTHROPIC_API_KEY`) and sends only the current project's cited facts.
- **Updates.** Cereal for Mac asks GitHub's public releases API whether a newer version is out, at most every
  six hours, and says so on Home with a download link. The request carries nothing but Cereal's version.
  `CEREAL_UPDATE_CHECK=0` turns it off.

## Boundaries

Cereal observes and organizes. It never edits project files, starts or resumes agents, merges, deletes
worktrees, or shares context between projects. Resume commands are shown for you to copy and run.
The server binds to 127.0.0.1 and refuses cross-origin writes.

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` | `4317` |
| `CEREAL_DATA_DIR` | `~/Library/Application Support/Cereal` |
| `CEREAL_PROJECTS_JSON` | Inline project list; overrides `<data dir>/projects.json` |
| `CEREAL_CLAUDE_DIR` / `CEREAL_CODEX_DIR` | `~/.claude/projects` / `~/.codex/sessions` |
| `CEREAL_AGENT_DAYS` | `21` — how far back to read sessions |
| `CEREAL_POLL_MS` | `15000` |
| `CEREAL_UPDATE_CHECK` | On in Cereal for Mac; `0` stops the check for a newer release |
| `CEREAL_APP_URL` | `http://127.0.0.1:4317` — where links in the briefing email point |
| `CEREAL_MAIL_PROVIDER`, `RESEND_API_KEY`, `CEREAL_MAIL_FROM` | Optional; overrides the key saved in Morning Briefing → Delivery |
