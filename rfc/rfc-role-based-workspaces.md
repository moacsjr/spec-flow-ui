# RFC-003 — Role-Based Workspace for the MVP

**Status:** Proposal

**Version:** 1.0

**Date:** 2026-07-07

---

# 1. Overview

The application provides different workspaces depending on the user's role.

Instead of exposing every project page to every user, the interface is optimized for the activities each role performs.

Supported roles:

* Product Manager
* Tech Leader
* Developer

Each role shares the same project data but has a different navigation structure.

---

# 2. Product Manager Workspace

The Product Manager owns the product definition and release planning.

## Dashboard

Shows an executive summary of the project.

Widgets:

* Project Health
* Features Delivered
* Stories by Stage
* Upcoming Milestones
* AI Insights

---

## Backlog

Purpose:

Manage incoming ideas before prioritization.

Displays:

* Initiatives
* Features
* User Stories

Filters:

* Repository
* Type
* Area
* Labels

Actions:

* Create Idea
* Launch AI Brainstorm
* Edit
* Delete
* Set Priority

Only items without priority appear in this view.

---

## Prioritization

Purpose:

Rank the work to be executed.

Displays:

All prioritized backlog items ordered by:

* P0
* P1
* P2
* P3

Sorting:

* Priority
* Business Value
* Creation Date

Actions:

* Change priority
* Move between priorities
* Send to Specification

---

## Planning

Purpose:

Build releases.

Displays:

Milestones.

Each milestone contains only User Stories.

Actions:

* Create milestone
* Rename milestone
* Assign Story
* Remove Story
* Change target date

Assigning a Story automatically updates the GitHub Milestone field.

Features and Initiatives are never assigned directly to milestones.

---

## Progress

Purpose:

Track delivery progress.

Displays:

Stories grouped by:

Milestone

Inside each milestone:

* Backlog
* Spec
* Plan
* Ready
* Development
* Code Review
* QA
* UAT
* Done

Widgets:

* Progress %
* Stories completed
* Stories blocked
* Estimated completion

AI Summary:

The assistant explains the current project status in natural language.

---

# 3. Tech Leader Workspace

The Tech Leader owns technical planning and execution quality.

## Dashboard

Widgets:

* Features awaiting specification
* Features awaiting technical review
* Stories in development
* Blocked Stories
* Pull Requests awaiting review
* AI Technical Insights

---

## Specification

Purpose:

Work on functional specifications.

Displays:

Features currently in the Spec stage.

Actions:

* Open Spec
* Generate Spec
* Request changes
* Approve Spec

---

## Technical Review

Purpose:

Review implementation plans.

Displays:

Features in Plan stage.

Each Feature shows:

* Spec Status
* Plan Status
* Approval Status

Actions:

* Generate Plan
* Review Plan
* Approve Plan
* Return for changes

---

## Technical Backlog

Purpose:

Organize development work.

Displays:

Stories grouped by:

* Milestone A
* Milestone B
* Story without Milestone

Actions:

* Move Story
* Assign Milestone
* Review decomposition

---

## Development

Purpose:

Monitor active work.

Displays:

Stories where Progress > 0.

Grouped by Milestone.

Shows:

* Progress
* Assignee
* Linked Pull Requests

---

## Code Review

Purpose:

Track pending code reviews.

Displays:

Stories waiting for Pull Request approval.

Each row includes:

* Story
* Pull Request
* Reviewer
* Waiting Time

Actions:

* Open PR
* Open Story

---

## QA

Purpose:

Monitor functional validation.

Displays:

Stories waiting for QA grouped by milestone.

Actions:

* Open Story
* Open Test Results

---

## UAT

Purpose:

Monitor business validation.

Displays:

Stories waiting for User Acceptance Testing grouped by milestone.

Actions:

* Open Story
* Approve
* Return to Development

---

## Progress

Purpose:

Track complete project execution.

Displays:

Stories grouped by:

Milestone

Within each milestone:

* Spec
* Plan
* Ready
* Development
* Code Review
* QA
* UAT
* Done

---

# 4. Developer Workspace

The Developer focuses exclusively on the current milestone.

The current milestone is selected at the top of the interface.

---

## Dashboard

Widgets:

* Current Milestone
* Assigned Stories
* Stories in Progress
* Pending Reviews
* AI Daily Summary

---

## Pending

Displays:

Stories from the current milestone.

Conditions:

* Ready
* Not started

Actions:

* Start Story

---

## In Progress

Displays:

Stories from the current milestone where progress > 0.

Shows:

* Progress
* Linked Tasks
* Linked Pull Requests

Actions:

* Continue work
* Open GitHub Issue

---

## Code Review

Displays:

Stories from the current milestone waiting for PR approval.

Shows:

* Pull Request
* Reviewer
* Waiting Time

---

## QA

Displays:

Stories from the current milestone waiting for QA.

Actions:

* Fix issues
* Open Story

---

## Progress

Displays:

All Stories from the selected milestone.

Grouped by stage:

* Ready
* Development
* Code Review
* QA
* UAT
* Done

Allows the developer to understand milestone progress without navigating through the entire project.

---

# 5. Shared Navigation

Every workspace includes:

* Project Selector
* Repository Selector
* Global Search
* Notifications
* AI Assistant

The role only changes the available pages, not the underlying project data.

---

# 6. Design Principles

The MVP follows these principles:

* One workspace per role.
* Every page must answer a specific question or support a primary workflow.
* Minimize navigation by surfacing the next actions.
* GitHub remains the source of truth.
* AI augments decision-making but never performs approvals autonomously.

I think this role-based organization is the right foundation for the product. One additional recommendation is to make the **Dashboard** the first page for every role, with personalized KPIs and AI insights. The remaining pages then become focused work queues ("what should I do next?"), rather than generic lists. This creates a much more guided experience while keeping the MVP relatively simple.
