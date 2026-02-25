# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email **security@georgeqle.dev** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. You will receive an acknowledgment within 48 hours
4. We will work with you to understand and address the issue before any public disclosure

## Security Considerations

The two-layer-cake SDK executes LLM-generated plans that may invoke tools with network access. Users should:

- Configure `permissions.allowedTools` to restrict tool access
- Enable `permissions.requireConfirmation` for sensitive tools (e.g., `http-fetch`)
- Use `blockedCIDRs` on the `http-fetch` tool to prevent SSRF attacks
- Never expose the orchestrator to untrusted input without proper sandboxing
