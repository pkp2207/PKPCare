// Consent / notice text shown before the join link.
export const VisitNotice = () => (
  <section
    aria-labelledby="notice-title"
    className="rounded-lg border border-dark-500 bg-dark-400 p-4"
  >
    <h2 id="notice-title" className="text-16-semibold">
      About this video visit
    </h2>
    <ul className="text-14-regular mt-2 list-disc space-y-1 pl-5 text-dark-700">
      <li>By joining you agree to take part in a video visit with your doctor.</li>
      <li>PKPCare does not record the visit. Please do not record it either.</li>
      <li>Join from a private place. Anyone with this link can try to enter the room.</li>
      <li>Do not share this link.</li>
    </ul>
  </section>
);
