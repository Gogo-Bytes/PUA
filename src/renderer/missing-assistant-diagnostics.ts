import { createMissingAssistantDiagnostics } from '../shared/missing-assistant-diagnostics';

// User must explicitly set the target Desktop session ID in this renderer's
// sessionStorage. No bridge capability, URL flag, persistence or automatic opt-in.
export const missingAssistantRendererDiagnostics = createMissingAssistantDiagnostics(
  () => sessionStorage.getItem('PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION') ?? undefined,
  line => console.info(line),
);
