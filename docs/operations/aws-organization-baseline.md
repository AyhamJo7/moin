# AWS organisation baseline (EXT-09, P05.01)

- **Status:** `IN_PROGRESS` — accounts, root MFA, budgets and the admin identity exist; SCPs, SES and quotas are open
- **Owner:** founder. Account creation, plan changes and credential handling are founder-only (CLAUDE.md §12).
- **Recorded:** 2026-10-14, from the founder's console screenshots and reports in one working session.
- **Evidence level:** mixed. §6 lists what the read-only AWS CLI report of 2026-10-14T21:43Z
  **VERIFIED**; everything not listed there is still **founder-reported / screenshot-read**.
  No `EV-` record exists yet; create one when P05.01 is closed (`evidence.py new --phase P05 …`).
  Repo gates do not cover this file: the last `gates fast` was FAIL (pnpm missing).

> **No secrets in this file.** It holds identifiers, settings and decisions only (INV-15). Passwords, MFA
> seeds or QR codes, recovery codes and access keys are never written here, pasted into a session or
> committed. They live in the founder's password manager and hardware keys.

## 1. Accounts

Organisation `o-4vrp99buz1`, root `r-9044`, all features enabled, created 2026-10-14.
Home region for everything: **`eu-central-1` (Frankfurt)**.

| Account           | ID           | Root e-mail (Gmail `+alias`, same inbox) | Role                                                        |
| ----------------- | ------------ | ---------------------------------------- | ----------------------------------------------------------- |
| `moin-management` | 711318977205 | `moin.management7@gmail.com`             | Management account: Organizations, billing, Identity Center |
| `moin-shared`     | 202518311313 | `moin.management7+shared@gmail.com`      | Shared services                                             |
| `moin-backup`     | 559422046950 | `moin.management7+backup@gmail.com`      | Backups                                                     |
| `moin-staging`    | 203883639520 | `moin.management7+staging@gmail.com`     | Staging                                                     |
| `moin-production` | 048506327769 | `moin.management7+production@gmail.com`  | Production                                                  |

- Member accounts were created from Organizations with the default role name `OrganizationAccountAccessRole`.
- Plan: **paid plan** was chosen at sign-up. The management account holds no credits.
- All five accounts sit directly under the organisation root; no OUs yet.

### Sandbox account (not part of the organisation)

| Account          | ID           | Notes                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moin` (project) | 451868250747 | Created first through "Sign up with Google" (new Projects/Team model, Builder ID). Free plan, $100 credits, 183 days left at creation (to 2027-04-14). **Has no root user** and cannot be an Organizations management account. Kept as a sandbox only. Not used for moin infrastructure. |

## 2. Identity and access

### Root user (management account)

- Sign-in: root e-mail + password, **passkey/security-key MFA**. Founder reports **two devices registered**;
  the screenshot showed one — second device is `UNVERIFIED`.
- "IAM user and role access to Billing information" was **activated by root** so the admin identity can open
  Account and billing pages (founder-reported; the alternate-contacts error before it is the reason).
- Alternate contacts (billing, operations, security) were set by the founder as root (founder-reported).
- Root is **break-glass only**. Daily work and Terraform use the Identity Center identity below.
- No root access keys.

### Member accounts

- Centralised root access management is enabled: trusted access for IAM is **on** in Organizations, and both
  options (root credentials management, privileged root actions) are on.
- The Root access management page shows **"Not present"** for the root credentials of all four member
  accounts, i.e. they have no root password, keys or MFA. Recovery goes through a privileged session from the
  management account.

### IAM Identity Center

| Setting           | Value                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance          | Organisation instance, **single-Region**, Europe (Frankfurt)                                                                                |
| Why single-Region | The multi-Region default replicates to US West (Oregon), which conflicts with the EU-only region rule (P05.01.02, INV-16) and adds KMS cost |
| Access portal     | `https://d-9967b1f5e8.awsapps.com/start`                                                                                                    |
| User              | `ayham-admin` (e-mail `moin.management7+admin@gmail.com`), MFA registered, second MFA device registered (founder-reported)                  |
| Group             | `admins`                                                                                                                                    |
| Permission set    | `AdministratorAccess` (predefined), session duration 4 hours                                                                                |
| Assignment        | group `admins` → `AdministratorAccess` on **all five accounts**                                                                             |

**Sign-in:** open the portal URL, sign in as `ayham-admin` with MFA, then choose account → `AdministratorAccess`
→ Management console. `ayham-admin` is an Identity Center user, not an IAM user: it has **no account ID**
and cannot use the "IAM user sign in" page (account ID + IAM username).

`AdministratorAccess` is a bootstrap choice. Least-privilege permission sets (deploy, read-only, break-glass)
are part of the P05 Terraform baseline.

## 3. Cost controls (P05.01.03)

| Control                   | Setting                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Budget `moin-org-monthly` | Cost budget, monthly, recurring, **$10.00**, start 2026-10-01, on the management account (consolidated billing covers all five accounts) |
| Budget alerts             | Actual cost > 80 % ($8.00); forecasted cost > 100 % ($10.00)                                                                             |
| Budget recipient          | `moin.management7@gmail.com`, **verified** (1/1)                                                                                         |
| Cost Anomaly Detection    | Monitor `Default-Services-Monitor` (AWS services, all services)                                                                          |
| Anomaly subscription      | `Default-Services-Subscription`: threshold **$5.00 above expected spend**, daily summaries, 1 recipient (was $100 AND 40 % by default)   |

Cost and Usage data showed "unavailable" right after creation; AWS says it can take up to 24 hours.
The $10 budget is deliberately tight for a pilot and is expected to be raised with real workloads.

## 4. Decisions and the reasons

| Decision                                                                                       | Reason                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New management account on the **advanced sign-up** (root user), not the Google/Builder-ID flow | Root credentials exist only on the advanced path (AWS sign-in docs). P05.01.01 needs root hardware MFA and an Organization                                                                     |
| **Paid plan** at sign-up                                                                       | A free-plan account that creates or joins an Organization is converted to paid and its free credits expire immediately (AWS Free Tier FAQ). A paid plan keeps the account valid for production |
| Root console cannot start privileged sessions                                                  | The Root access management page showed "RootSession may not be assumed by root accounts" while signed in as root; it worked after signing in as the Identity Center user                       |
| Single-Region Identity Center                                                                  | EU-only residency and no extra KMS cost (see §2)                                                                                                                                               |
| Gmail `+alias` for member roots                                                                | Distinct, valid per account, one inbox. Replace with domain mailboxes once the domain (DG-00) exists                                                                                           |

## 5. Open items

| Item                                                                                                                                                  | State                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P05.01.02 SCPs: deny regions except `eu-central-1` + EU DR region; protect CloudTrail/GuardDuty/Backup; deny public S3; deny leaving the organisation | Open — written as Terraform in P05 (needs the bootstrap first)                                                                                                                                                                                                                                         |
| P05.01.04 SES production access                                                                                                                       | **Blocked on the sending domain (DG-00).** Founder owns `iquantum.co` (the portfolio site) and no moin- or KlarDesk-specific domain. Whether to send from a subdomain of `iquantum.co` or buy a product domain is **undecided** (brand, DPA and deliverability reasons); decide before the SES request |
| P05.01.05 Service-quota check (Fargate vCPU, ALB, EIP)                                                                                                | Open                                                                                                                                                                                                                                                                                                   |
| P05.01.06 Proof that a non-EU resource is denied by SCP                                                                                               | Open — after SCPs                                                                                                                                                                                                                                                                                      |
| Second root MFA device                                                                                                                                | Founder-reported only; verify on the Security credentials page                                                                                                                                                                                                                                         |
| Domain mailboxes replacing the `+alias` e-mails                                                                                                       | After DG-00                                                                                                                                                                                                                                                                                            |
| EXT-09 "accounts active; SES out of sandbox" (PLAN.md row)                                                                                            | **Not satisfied** until SES is out of the sandbox                                                                                                                                                                                                                                                      |

## 6. Verification report (2026-10-14T21:43:44Z)

Source: `~/aws-baseline-verification.txt` (11938 bytes, SHA-256
`02c6d9916c7bd7dab9e96f62e66e1e279a6ed2349342b675cd3fce0b12806432`), produced by a read-only script run by
the founder with the SSO profile `moin-readonly` (role session `AWSReservedSSO_moin-readonly_…/ayham-admin` in
`moin-management`). The report is stored by reference only; it holds identifiers and no secrets.

| Claim                                                                                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organisation `o-4vrp99buz1`, root `r-9044`, feature set `ALL`, management account 711318977205                                                             | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Five accounts, IDs, names, e-mails, all `ACTIVE` (§1)                                                                                                      | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Trusted access enabled for `iam.amazonaws.com` and `sso.amazonaws.com`                                                                                     | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Centralised root access: `RootSessions` and `RootCredentialsManagement` enabled                                                                            | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Root MFA on (`AccountMFAEnabled` = 1) and no root access keys (`AccountAccessKeysPresent` = 0) in the management account                                   | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Number of root MFA devices (founder says two)                                                                                                              | UNVERIFIED — the report only shows that MFA is on                                                                                                                                                                                                                                                                                                                                                                            |
| Identity Center instance `ssoins-6987abadd7cf0fe9`, store `d-9967b1f5e8`, owner 711318977205, status ACTIVE, only region `eu-central-1` (single-Region)    | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Permission sets `moin-readonly` (policies `SecurityAudit`, `ViewOnlyAccess`) and `AdministratorAccess`, both `PT4H`, both provisioned to all five accounts | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| One user `ayham-admin`, one group `admins`                                                                                                                 | **VERIFIED**                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `admins` is the principal assigned `AdministratorAccess`; `ayham-admin` is a member of `admins`; `moin-readonly` is assigned to `ayham-admin` or `admins`  | UNVERIFIED — the report lists provisioned accounts, not assignment principals or membership                                                                                                                                                                                                                                                                                                                                  |
| `ayham-admin` second MFA device                                                                                                                            | UNVERIFIED — not queried                                                                                                                                                                                                                                                                                                                                                                                                     |
| Alternate contacts BILLING, OPERATIONS, SECURITY exist                                                                                                     | **VERIFIED** (presence only; contents not queried)                                                                                                                                                                                                                                                                                                                                                                           |
| Budget `moin-org-monthly` ($10, 80 % actual / 100 % forecast, verified recipient)                                                                          | UNVERIFIED by CLI — `budgets:ViewBudget` denied for `moin-readonly`; screenshot evidence only                                                                                                                                                                                                                                                                                                                                |
| Anomaly monitor and `$5` subscription                                                                                                                      | UNVERIFIED by CLI — `ce:GetAnomalyMonitors` / `ce:GetAnomalySubscriptions` denied; screenshot evidence only                                                                                                                                                                                                                                                                                                                  |
| "IAM user and role access to Billing information" activated                                                                                                | UNVERIFIED — not queried                                                                                                                                                                                                                                                                                                                                                                                                     |
| Management account plan type (paid)                                                                                                                        | UNVERIFIED — not queried                                                                                                                                                                                                                                                                                                                                                                                                     |
| Service control policies                                                                                                                                   | **VERIFIED** that two exist: `FullAWSAccess` and a custom `DenyLeaveAndCloseAccount` (`p-p3xm213u`: "Prevents member accounts from leaving the organization and self closure"). Whether and where it is attached was not queried. Its creator is not recorded here: confirm with the founder, since §5 expected only `FullAWSAccess`. The regional deny and the CloudTrail/GuardDuty/Backup protections do **not** exist yet |

**Gap in the read-only role:** `ViewOnlyAccess` + `SecurityAudit` do not include Budgets or Cost Explorer
anomaly reads. Candidates to add to `moin-readonly`: `AWSBudgetsReadOnlyAccess` and a billing read policy; I
have not checked which managed policies cover `ce:GetAnomaly*`, so confirm the policy names in the console
before attaching them.

## 7. What not to repeat

- Do not sign up through "Continue with Google" for infrastructure accounts: it creates a Builder ID and no root user.
- Do not create an Organization from a free-plan account that still holds credits you want.
- Do not use the root user for the Root access management console; use the Identity Center admin.
- Do not paste QR codes, MFA codes or passwords into chats or screenshots; the QR code contains the MFA seed.
