// Pre-join device check instructions. Static text: this page cannot test the
// camera itself (the site Permissions-Policy denies camera / microphone to our
// own origin by design; media is only used on the video provider's site).
const ITEMS = [
  "Use an up-to-date Chrome, Edge, Safari or Firefox, on a phone, tablet or computer.",
  "When the video page asks, choose Allow for your camera and microphone. The video page shows a preview before you enter.",
  "Use headphones if you can, and sit in a quiet, private place with good light.",
  "Check your internet connection and close other apps that use the camera or microphone.",
  "If you cannot hear or be heard, check the microphone and speaker choices on the video page before contacting the clinic.",
];

export const DeviceChecklist = () => (
  <section aria-labelledby="checklist-title" className="flex flex-col gap-3">
    <h2 id="checklist-title" className="sub-header">
      Before you join
    </h2>
    <ol className="list-decimal space-y-2 pl-6 text-dark-700">
      {ITEMS.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  </section>
);
