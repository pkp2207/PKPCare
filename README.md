# PKPCare


<div align="center">
  <img src = "https://github.com/pkp2207/PKPCare/assets/58586336/4b8f9132-909f-4973-a3f3-522fd2b5ac7c">
  <h3 align="center">A HealthCare Management System</h3>
</div>

## 📋 <a name="table">Table of Contents</a>

1. 🤖 [Introduction](#introduction)
2. ⚙️ [Tech Stack](#tech-stack)
3. 🔋 [Features](#features)
4. 🤸 [Quick Start](#quick-start)
5. 📜 [Scripts](#scripts)
6. 🧪 [Testing](#testing)
7. 🔒 [Security Notes](#security)

## <a name="introduction">🤖 Introduction</a>

A healthcare patient management application that allows patients to easily register, book, and manage their appointments with doctors, featuring administrative tools for scheduling, confirming, and canceling appointments, along with SMS notifications, all built using Next.js.


## <a name="tech-stack">⚙️ Tech Stack</a>

- Next.js
- Appwrite
- Typescript
- TailwindCSS
- ShadCN
- Twilio

## <a name="features">🔋 Features</a>

👉 **Register as a Patient**: Users can sign up and create a personal profile as a patient.

👉 **Book a New Appointment with Doctor**: Patients can schedule appointments with doctors at their convenience and can book multiple appointments.

👉 **Manage Appointments on Admin Side**: Administrators can efficiently view and handle all scheduled appointments.

👉 **Confirm/Schedule Appointment from Admin Side**: Admins can confirm and set appointment times to ensure they are properly scheduled.

👉 **Cancel Appointment from Admin Side**: Administrators have the ability to cancel any appointment as needed.

👉 **Send SMS on Appointment Confirmation**: Patients receive SMS notifications to confirm their appointment details.

👉 **Complete Responsiveness**: The application works seamlessly on all device types and screen sizes.

👉 **File Upload Using Appwrite Storage**: Users can upload and store files securely within the app using Appwrite storage services.

👉 **Manage and Track Application Performance Using Sentry**: The application uses Sentry to monitor and track its performance and detect any errors.

and many more, including code architecture and reusability

## <a name="quick-start">🤸 Quick Start</a>

Follow these steps to set up the project locally on your machine.

**Prerequisites**

Make sure you have the following installed on your machine:

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/en)
- [npm](https://www.npmjs.com/) (Node Package Manager)

**Cloning the Repository**

```bash
git clone https://github.com/pkp2207/PKPCare.git
cd PKPCare
```

**Installation**

Install the project dependencies using npm:

```bash
npm install
```

**Set Up Environment Variables**

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable                     | Scope       | Description                                              |
| ---------------------------- | ----------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_ENDPOINT`       | public      | Appwrite endpoint, e.g. `https://cloud.appwrite.io/v1`   |
| `NEXT_PUBLIC_BUCKET_ID`      | public      | Appwrite storage bucket for ID documents                 |
| `PROJECT_ID`                 | server only | Appwrite project ID                                      |
| `API_KEY`                    | server only | Appwrite API key (never expose to the browser)           |
| `DATABASE_ID`                | server only | Appwrite database ID                                     |
| `PATIENT_COLLECTION_ID`      | server only | Appwrite patient collection ID                           |
| `APPOINTMENT_COLLECTION_ID`  | server only | Appwrite appointment collection ID                       |
| `ADMIN_PASSKEY`              | server only | Passkey admins enter to unlock the admin area            |
| `ADMIN_SESSION_SECRET`       | server only | HMAC secret used to sign the admin session cookie        |
| `SENTRY_AUTH_TOKEN`          | build only  | Optional. Source-map upload; omitted means a dry run     |

Generate a strong `ADMIN_SESSION_SECRET`:

```bash
openssl rand -base64 48
```

> **Note:** `NEXT_PUBLIC_ADMIN_PASSKEY` has been **removed**. Any `NEXT_PUBLIC_*`
> variable is bundled into client JavaScript, which would leak the passkey. Use the
> server-only `ADMIN_PASSKEY` instead, and delete the old variable from your `.env`
> and hosting provider.

You can obtain Appwrite credentials by signing up on the [Appwrite website](https://appwrite.io/).

**Running the Project**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the project.

## <a name="scripts">📜 Scripts</a>

| Command              | Description                            |
| -------------------- | -------------------------------------- |
| `npm run dev`        | Start the dev server                   |
| `npm run build`      | Production build                       |
| `npm start`          | Serve the production build             |
| `npm run lint`       | ESLint (`next lint`)                   |
| `npm run typecheck`  | TypeScript check (`tsc --noEmit`)      |
| `npm test`           | Run unit tests once (Vitest)           |
| `npm run test:watch` | Run tests in watch mode                |

## <a name="testing">🧪 Testing</a>

Unit tests live in `tests/` and run with [Vitest](https://vitest.dev/). They are pure
unit tests: no network, no Appwrite, no `.env` required.

```bash
npm test             # run once
npm run test:watch   # watch mode
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every push and
pull request to `main`, using dummy non-secret env values for the build.

## <a name="security">🔒 Security Notes</a>

- Admin access uses a server-verified passkey (`ADMIN_PASSKEY`) and issues a signed,
  `HttpOnly` session cookie (HMAC-SHA256 with `ADMIN_SESSION_SECRET`, limited lifetime).
  The passkey is never shipped to the browser.
- Never commit `.env` or any API keys, passkeys or secrets. Only `.env.example`
  (placeholders) belongs in git.
- If a key or secret has ever been committed or otherwise exposed, rotate it
  immediately (Appwrite `API_KEY`, `ADMIN_PASSKEY`, `ADMIN_SESSION_SECRET`,
  `SENTRY_AUTH_TOKEN`). Changing `ADMIN_SESSION_SECRET` invalidates all existing admin
  sessions.
- The Appwrite `API_KEY` is server-only; do not import server env into client components.
