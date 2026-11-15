<p align="center"><img src="docs/images/clinicle-readme-banner.svg" alt="Clinicle Intelligence" width="620" /></p>

<p align="center">Private repository · Proprietary · Python 3.12 · v2.1.9</p>

**Clinicle Intelligence** is a multi-tenant AI operations platform for healthcare and clinic groups. It runs a team of purpose-built AI agents — each with its own persona, skills, knowledge base, and workspace — that monitor service quality, recover revenue, staff a contact center, guide patients through their journey, support doctors and management, and flag financial/compliance risk before it becomes a problem. Nothing acts autonomously on money, compliance, or patient data without a human approving it first.

Under the hood, Clinicle Intelligence is a general-purpose **Agent Harness**: a multi-agent framework, a visual workflow engine, a knowledge base, long-term memory, a tamper-evident audit trail, and multi-tenant RBAC — all exposed through one Web console.

<br/>

## 🏥 What it does

Ten agents, wired for a clinic group's real operating rhythm:

| Agent | Watches for |
| :--- | :--- |
| **AI Quality Supervisor** | Service quality, response times, sentiment, and compliance across calls, WhatsApp, CRM, and meetings |
| **AI Revenue Optimization Engine** | Stalled leads, no-shows, lost leads, empty slots, next-best-action recall opportunities |
| **AI Contact Center** | Voice & WhatsApp inquiries — booking, rescheduling, confirmations, escalation to a human |
| **Patient Journey AI** | Inquiry → booking → treatment → follow-up → recall, personalized end to end |
| **Doctor AI Copilot** | Consultation documentation, patient history summaries, follow-up requirements |
| **Employee AI Copilot** | SOPs, HR policy, protocols — an internal knowledge assistant for staff |
| **Management AI Copilot & KPI Intelligence** | Departmental KPIs, anomaly detection, automated reporting, minutes of meeting |
| **VAT Audit & ZATCA Compliance AI** | Transactions, invoices, and VAT classification errors before submission |
| **Inventory & Procurement AI** | Stock levels vs. upcoming appointments and treatment mix, shortages/waste/overbuying |
| **AI Financial Controller & Internal Auditor** | Revenue leakage, excessive discounts/refunds, reconciliation and control gaps |

**Flag, never auto-act.** The four highest-liability agents (Quality, Revenue, VAT, Financial) never take action on their own — they raise a flag into the shared **Review Queue**, which a human approves or dismisses. Every flag is also written to the tamper-evident audit log and surfaces in **Alerts**.

<br/>

## 🌟 Platform capabilities

| Capability | Description |
| :--- | :--- |
| **Standalone or Team chat** | Talk to any single Agent directly on the Home screen, or hand a task to a full Team — both live side by side |
| **Multi-Agent Teams** | Functional teams (Patient Experience, Clinical & Staff, Finance & Compliance, Management) with a designated leader delegating to teammates |
| **Review Queue** | Shared "AI found something, a human decides" surface — org-scoped, severity-ranked, fully audited |
| **Workflows** | Visual DAG engine (trigger → action → condition nodes) for scheduled and webhook-driven automations, e.g. daily quality review, weekly KPI report |
| **Meeting Assistant** | Live bot-join capture with automatic minutes-of-meeting and action-item extraction |
| **Task Board** | Kanban-style board (backlog → todo → in progress → review → done) shared across agents and humans |
| **Knowledge Base** | Category-organized knowledge shared across agents — SOPs, HR policy, compliance rules |
| **Analytics & Overview** | Live dashboard: queries served, agent roster, connectors, audit-chain status, open Review Queue flags |
| **Sovereignty & Audit** | Tamper-evident, hash-chained audit log; org-level data retention and deletion controls |
| **Security & Access** | Multi-tenant RBAC, session management, role-scoped admin controls |
| **Connectors** | All third-party integrations route through Composio — no direct vendor SDKs |
| **Models** | Bring your own LLM provider (Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi, and more), configured per-agent from the Web console |

<br/>

## 🚀 Quick Start

```bash
git clone <this-repo-url>
cd CowAgent
./run.sh              # first run: installs dependencies and walks through configuration
./run.sh start        # start the service
```

Once started, open `http://localhost:9899` for the Web console — chat with any Agent or Team, configure models and connectors, manage the Review Queue, and build Workflows.

> Deploying on a server? Set `web_host` to `0.0.0.0` in `config.json` to make the console reachable from outside, and set `web_password` to protect it. Open port `9899` in your firewall/security group.

Manage the running service with `./run.sh`:

```bash
./run.sh start | stop | restart   # service control
./run.sh status | logs            # status and logs (tail -f)
./run.sh config                   # reconfigure
./run.sh update                   # pull latest code and restart
```

<br/>

## 🏗️ Architecture

Each Agent is a fully independent workspace — its own `AGENT.md` (persona), `USER.md`, `RULE.md` (behavioral boundaries), `MEMORY.md`, and `BOOTSTRAP.md` — built on the shared Agent Core, which plans and reasons over memory, knowledge, and available tools/skills before a Model generates the response. Teams compose multiple Agents around a shared conversation with delegation instructions seeded for the leader. Every layer — Channels, Agent Core, Tools/Skills, Models — is decoupled and independently extensible.

<br/>

## 🛠️ Development & Contributing

Contributions are welcome — new agents, new capabilities, bug fixes, or docs. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

<br/>

## ⚠️ Disclaimer

1. This project is proprietary and confidential — see [LICENSE](LICENSE). You are responsible for complying with applicable laws and regulations in your jurisdiction (including healthcare data-protection requirements); the maintainers assume no liability for any consequences arising from use of this project.
2. **Cost & safety:** Agent mode consumes substantially more tokens than regular chat — pick models that balance quality and cost. Agents have access to your configured tools and connectors, so only deploy in trusted environments with appropriate access controls.
3. High-liability agents (VAT Compliance, Financial Controller, Revenue Optimizer, Quality Supervisor) are designed to flag and report only — they never file, submit, or auto-act on financial or compliance matters. Verify this boundary holds for your own deployment and configuration before relying on it.
