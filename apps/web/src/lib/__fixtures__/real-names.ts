// D-079: web fixtures carry no real vendor, product, API, field or event name, nor a vendor's id prefix.
export const REAL_NAMES =
  /\b(?:github|neon|vercel|stripe|aws|cloudtrail|anthropic|claude|livemode|webhookEndpoints|webhook_endpoint|workflow_run|check_run|pull_request|actions\/runs|deployment\.(?:created|ready|error|promoted))\b|\b(?:toolu|we|req|dpl|evt|sk|pk)_\w/i;
