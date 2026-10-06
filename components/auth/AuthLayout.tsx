import Image from "next/image";
import Link from "next/link";

// Shared chrome for /login and /login/staff; mirrors the home page layout.
export const AuthLayout = ({
  children,
  footerLink,
}: {
  children: React.ReactNode;
  footerLink: { href: string; label: string };
}) => (
  <div className="flex h-screen max-h-screen">
    <section className="remove-scrollbar container my-auto">
      <div className="sub-container max-w-[496px]">
        <Image
          src="/assets/icons/logo-full-pkp.png"
          height={150}
          width={150}
          alt="PKPCare"
          className="mb-8"
        />

        <main id="main" className="flex-1">{children}</main>

        <div className="text-14-regular mt-20 flex justify-between">
          <p className="justify-items-end text-dark-600 xl:text-left">
            © 2024 PKPCare
          </p>
          <Link href={footerLink.href} className="text-green-500">
            {footerLink.label}
          </Link>
        </div>
      </div>
    </section>

    <Image
      src="/assets/images/onboarding-img.png"
      height={1000}
      width={1000}
      alt=""
      aria-hidden="true"
      className="side-img max-w-[50%]"
    />
  </div>
);
