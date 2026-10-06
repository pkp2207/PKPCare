import Image from "next/image";

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-center size-full h-screen gap-3 text-white"
    >
      <Image
        src="/assets/icons/loader.svg"
        alt=""
        aria-hidden="true"
        width={40}
        height={40}
        className="animate-spin"
      />
      Loading...
    </div>
  );
}
