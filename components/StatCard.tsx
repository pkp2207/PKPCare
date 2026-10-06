import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";

type StatCardProps = {
  type: "appointments" | "pending" | "cancelled";
  count: number;
  label: string;
  icon: string;
  /** Optional: makes the card a link (e.g. to the matching status filter). */
  href?: string;
};

export const StatCard = ({
  count = 0,
  label,
  icon,
  type,
  href,
}: StatCardProps) => {
  const body = (
    <>
      <div className="flex items-center gap-4">
        <Image
          src={icon}
          height={32}
          width={32}
          alt=""
          aria-hidden="true"
          className="size-8 w-fit"
        />
        <p className="text-32-bold text-white">{count}</p>
      </div>

      <p className="text-14-regular">{label}</p>
    </>
  );

  const className = clsx("stat-card", {
    "bg-appointments": type === "appointments",
    "bg-pending": type === "pending",
    "bg-cancelled": type === "cancelled",
  });

  if (href) {
    return (
      <Link
        href={href}
        className={clsx(
          className,
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
        )}
        aria-label={`${label}: ${count}. Show these appointments`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={className} role="group" aria-label={`${label}: ${count}`}>
      {body}
    </div>
  );
};
