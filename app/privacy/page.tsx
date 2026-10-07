import type { Metadata } from "next";
import Link from "next/link";

import { CURRENT_POLICY_VERSION } from "@/lib/compliance/consent";

export const metadata: Metadata = { title: "Privacy notice | PKPCare" };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="sub-header">{title}</h2>
    <div className="space-y-2 text-dark-700">{children}</div>
  </section>
);

// Public, static summary. ALL WORDING BELOW IS PLACEHOLDER TEXT.
const PrivacyPolicy = () => (
  <div className="mx-auto min-h-screen w-full max-w-3xl px-[5%] py-8 sm:px-6">
    <a
      href="#main"
      className="sr-only rounded-md bg-green-500 text-dark-200 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:px-4 focus:py-2"
    >
      Skip to main content
    </a>
    <header className="border-b border-dark-500 pb-4">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-md text-green-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        PKPCare home
      </Link>
    </header>

    <main id="main" className="space-y-8 py-8">
      <h1 className="header">Privacy notice</h1>

      <p
        role="note"
        className="text-14-medium rounded-md border border-blue-500 bg-blue-600 p-4 text-white"
      >
        Placeholder text - to be reviewed by counsel before launch. It is a plain-language summary
        for development and is not legal advice. Policy version {CURRENT_POLICY_VERSION}.
      </p>

      <Section title="What we collect">
        <p>
          Your name, contact details, date of birth, address, emergency contact, insurance details,
          a copy of your ID, health history you give us, and records of your appointments.
        </p>
      </Section>
      <Section title="Why we use it">
        <p>
          To register you as a patient, book and manage appointments, provide care, bill for it,
          and keep you informed about your appointments.
        </p>
      </Section>
      <Section title="Who sees it">
        <p>
          Clinic staff and doctors who need it to care for you, and service providers that run our
          systems (hosting, email and text messages, video visits, payments). We do not sell your
          information.
        </p>
      </Section>
      <Section title="How long we keep it">
        <p>[Retention periods to be confirmed by counsel.]</p>
      </Section>
      <Section title="Your choices and rights">
        <p>
          You can see your consents, withdraw them, download a copy of your data, and ask us to
          delete your account from the Privacy and data page after you sign in. Some records may
          have to be kept by law.
        </p>
      </Section>
      <Section title="Security">
        <p>
          Sensitive fields are encrypted in our database and access is limited to authorised staff
          and logged. No system is perfectly secure.
        </p>
      </Section>
      <Section title="Contact">
        <p>[Privacy contact and grievance officer details to be added.]</p>
      </Section>
    </main>
  </div>
);

export default PrivacyPolicy;
