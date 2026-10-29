Everyone signs in with their own account. What they can do depends on their role, and Coffer checks it on every request.

| Role | Can |
| --- | --- |
| Owner | Everything an admin can, plus download backups, restore and erase a donor. |
| Admin | Approve and export letters and appeals, reverse gifts, answer goods-or-services questions, move records in, change letter settings, manage agent keys, and download letter and audience files. |
| Member | Add and edit donors, and record gifts, pledges and consent. |
| Agent key | Read records, and prepare letter batches and appeal audiences for a person to approve. |

**More → Data & access** summarizes the roles and lists everyone with access.

## Invite someone

1. An owner or admin opens **More → Data & access**.
2. Under **People and roles**, enter the person's email address and, if you like, their name, and choose **Member** or **Admin**.
3. Press **Send invitation**.

On a hosted Coffer, the person gets an email with a one-use sign-in link. Opening it signs them in with the role you chose; after that they sign in with that address from the sign-in page whenever they like. Invitations need the installation's mail settings ([Coffer deployment details](/docs/deployment#mail)).

Coffer on your own computer sends no email. After you invite someone there, a **Sign in as** link appears next to their name: it signs this browser in as them, so you can see Coffer with their role. Open your `RER_OPEN` link again to come back as the owner.

The person's role and status show in the list. The owner can invite members and admins; an admin can invite members.

## Agent keys

An owner or admin creates a key in **More → Data & access** under **Agent keys**: describe what the agent is for and press **Create key**. The key is shown once; copy it into your agent's private settings. Keys expire after 30 days and can be revoked at any time. A key also stops working if the person who created it is switched off or changes role.

An agent can read donors, gifts, letters and appeals, and prepare letter batches and appeal audiences. It can never approve, export, record gifts or consent, move records in, restore or erase. [Agent keys and commands](/docs/agent-commands) lists everything an agent can call.
