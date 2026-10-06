import { isFhirEnabled } from "@/lib/fhir/auth";
import { handleFhirRequest } from "@/lib/fhir/handler";
import { methodNotAllowed, notEnabled } from "@/lib/fhir/outcome";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: { path?: string[] } };

// Read-only FHIR R4 facade. See docs/interop.md.
export const GET = (request: Request, { params }: RouteContext) =>
  handleFhirRequest(request, params.path);

const reject = () => (isFhirEnabled() ? methodNotAllowed() : notEnabled());

export const POST = reject;
export const PUT = reject;
export const PATCH = reject;
export const DELETE = reject;
export const OPTIONS = reject;
