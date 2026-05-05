import DOMPurify from "dompurify"

/**
 * Sanitize an HTML fragment produced by the Codex markdown renderer.
 *
 * The Codex assistant can echo arbitrary file contents into chat output,
 * so any HTML we feed into `dangerouslySetInnerHTML` must be scrubbed of
 * scripts, event handlers, and dangerous URI schemes (javascript:, data:, …).
 *
 * Config notes:
 * - `ALLOWED_URI_REGEXP` restricts href/src to http(s), mailto, and tel.
 * - `ADD_ATTR: ["target", "rel"]` keeps anchors usable; `target` is otherwise
 *   stripped by DOMPurify defaults in some builds.
 */
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
    ADD_ATTR: ["target", "rel"],
  })
}
