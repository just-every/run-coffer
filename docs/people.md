Everyone signs in with their own account. What they can do depends on their role, and Coffer checks it on every request.

| Role | Can |
| --- | --- |
| Owner | Everything an admin can, plus download backups, restore and erase a donor. |
| Admin | Approve and export letters and appeals, reverse gifts, answer goods-or-services questions, move records in, change letter settings, manage agent keys, and download letter and audience files. |
| Member | Add and edit donors, and record gifts, pledges and consent. |
| Agent key | Read records, and prepare letter batches and appeal audiences for a person to approve. |

**More → Data & access** summarizes the roles and shows your operator ID.

## Invite someone

Invitations use Coffer's sign-in routes, called while you are signed in as the owner from the app's own address: `POST /auth/invite` with the person's email, display name and role (`member` or `admin`). `GET /auth/operators` lists people, and `POST /auth/operator/role` and `POST /auth/operator/status` change a person's role or switch their access off. Hosted invitations need mail set up; local use sends no email.

## Agent keys

An owner or admin creates a key in **More → Data & access** under **Agent keys**: describe what the agent is for and press **Create key**. The key is shown once; copy it into your agent's private settings. Keys expire after 30 days and can be revoked at any time. A key also stops working if the person who created it is switched off or changes role.

An agent can read donors, gifts, letters and appeals, and prepare letter batches and appeal audiences. It can never approve, export, record gifts or consent, move records in, restore or erase. [Agent keys and commands](/docs/agent-commands) lists everything an agent can call.
