/**
 * Static security validator for skill content. The validator classifies a
 * skill body into VALID / WARNING / BLOCKED without rewriting anything: it
 * only reports findings with matched evidence so the user decides. Rules are
 * deliberately conservative — they flag explicit instruction-override,
 * concealment, escalation, destructive, and remote-execution phrasing, not
 * ordinary domain instructions.
 * @module @deepseek-ai/dsh-skill-manager/security
 */

import type { SecurityFinding, SecurityFindingSeverity, SecurityVerdict } from './types.ts'

interface SecurityRule {
  readonly rule: string
  readonly severity: Extract<SecurityFindingSeverity, 'warning' | 'blocked'>
  readonly pattern: RegExp
  readonly message: string
}

/** Rules that must block activation of the skill. */
const BLOCKED_RULES: readonly SecurityRule[] = [
  {
    rule: 'instruction-override',
    severity: 'blocked',
    pattern: new RegExp(
      String.raw`\b(ignore|disregard|override|forget|drop)\s+(all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)*`
        + String.raw`(previous|prior|above|system|earlier)?\s*(instructions|guidelines|prompts?|rules|directives|system prompt|system instructions)\b`,
      'iu',
    ),
    message: 'Instructs the model to override or ignore its system instructions.',
  },
  {
    rule: 'reveal-system',
    severity: 'blocked',
    pattern: /\b(reveal|print|output|show|repeat|display|disclose)\s+(your|the|its)\s+(full\s+)?(system\s+)?(prompt|instructions)\b/iu,
    message: 'Asks the model to reveal or repeat its system prompt.',
  },
  {
    rule: 'concealment',
    severity: 'blocked',
    pattern: new RegExp(
      String.raw`\b(do\s+not|don'?t|never|must\s+not|should\s+not)\s+`
        + String.raw`(tell|inform|notify|mention|reveal|say)\s+(the|your|this)?\s*(user|human|person)\b|`
        + String.raw`\b(secretly|quietly|silently|without\s+(telling|informing|notifying|mentioning)`
        + String.raw`\s+(the|your)?\s*(user|human|person))\b|`
        + String.raw`\bdo\s+not\s+mention\s+this\s+(conversation|prompt|instruction|message)\b`,
      'iu',
    ),
    message: 'Instructs the model to conceal its behavior or this instruction from the user.',
  },
  {
    rule: 'security-policy-override',
    severity: 'blocked',
    pattern: new RegExp(
      String.raw`\b(disable|bypass|turn\s+off|remove|deactivate|skip|ignore)\s+(the\s+)?`
        + String.raw`(security|safety|approval|permission|policy)\s*(checks?|policies?|restrictions?|validation|review|system)?\b|`
        + String.raw`\bremove\s+(the\s+)?(security|safety)\s+(restrictions?|checks?)\b`,
      'iu',
    ),
    message: 'Attempts to disable or bypass security and approval policy.',
  },
  {
    rule: 'credential-exfiltration',
    severity: 'blocked',
    pattern: new RegExp(
      String.raw`\b(send|upload|exfiltrate|leak|transmit|post)\s+(the\s+)?`
        + String.raw`(api\s*key|credentials?|passwords?|secrets?|tokens?|private\s+keys?)\s+to\b|\bexfiltrate\b`,
      'iu',
    ),
    message: 'Attempts to send credentials or secrets to an external destination.',
  },
  {
    rule: 'destructive-command',
    severity: 'blocked',
    pattern: new RegExp(
      String.raw`\brm\s+-rf\s+(\/|~|--no-preserve-root)|\bformat\s+c:|\bformat\s+c\\|`
        + String.raw`\b>\s*\/dev\/sda\b|\bmkfs(\.\w+)?\s+\/dev\/|\bdd\s+if=.*\bof=\/dev\/|`
        + String.raw`\bdel\s+\/f\s+\/s\s+\/q|\brd\s+\/s\s+\/q\s+c:|\bshutdown\s+\/s\s+\/f\b`,
      'iu',
    ),
    message: 'Contains a destructive filesystem or system command.',
  },
]

/** Rules that downgrade activation to WARNING. */
const WARNING_RULES: readonly SecurityRule[] = [
  {
    rule: 'remote-execution',
    severity: 'warning',
    pattern: new RegExp(
      String.raw`\b(curl|wget|iwr|invoke-webrequest)\s+[^\n|]*\|\s*(sh|bash|zsh|powershell|pwsh|python|node)\b|`
        + String.raw`\b(iex|Invoke-Expression)\s*\(|\bpowershell\s+(-enc|-e\s+|-encodedcommand)\b|`
        + String.raw`\b(base64\s*(-d|--decode)\s*[^\n|]*\|\s*(sh|bash|python|node))\b`,
      'iu',
    ),
    message: 'Pipes or decodes remote content into an interpreter; verify the source before following.',
  },
  {
    rule: 'privilege-escalation',
    severity: 'warning',
    pattern: new RegExp(
      String.raw`\b(sudo\s+su\b|sudo\s+!!|\bgive\s+(me\s+)?(admin|root|administrator)\s+(access|privileges)|`
        + String.raw`run\s+as\s+(admin|root|administrator)|escalat\w*\s+(to\s+)?(admin|root|administrator) privileges|`
        + String.raw`chmod\s+777\s+\/|chown\s+root\s+\/)\b`,
      'iu',
    ),
    message: 'Requests elevated privileges or root ownership; confirm the user intended this.',
  },
  {
    rule: 'suspicious-external-resource',
    severity: 'warning',
    pattern: /\bhttps?:\/\/[^\s<>"']+\b/iu,
    message: 'References external URLs; validate the destinations before the model fetches them.',
  },
  {
    rule: 'script-execution',
    severity: 'warning',
    pattern: /\b(run|execute|source|invoke)\s+(the\s+)?(scripts?\/|\.\/scripts?\/|scripts?\/[a-z0-9._-]+)\b/iu,
    message: 'Instructs running bundled scripts without describing what they do; review the script content first.',
  },
]

const ALL_RULES: readonly SecurityRule[] = [...BLOCKED_RULES, ...WARNING_RULES]

/**
 * Run the static security validator over complete skill text (frontmatter and
 * body). The verdict is `blocked` when any blocked rule matches, `warning`
 * when only warning rules match, and `valid` otherwise. Findings carry the
 * matched evidence so the caller can show the user exactly what tripped.
 * @param content - full SKILL.md text.
 * @returns the verdict and every finding, ordered severity-first.
 */
export function securityCheck(content: string): SecurityVerdict {
  const findings: SecurityFinding[] = []
  for (const rule of ALL_RULES) {
    for (const match of allMatches(content, rule.pattern)) {
      findings.push({
        severity: rule.severity,
        rule: rule.rule,
        message: rule.message,
        evidence: match[0].trim().slice(0, 200),
      })
    }
  }
  const status = findings.some(finding => finding.severity === 'blocked')
    ? 'blocked'
    : findings.length > 0
      ? 'warning'
      : 'valid'
  return { status, findings }
}

/** Every non-overlapping match of a rule pattern, adding the global flag `matchAll` requires. */
function allMatches(content: string, pattern: RegExp): RegExpMatchArray[] {
  /* v8 ignore next -- all shipped rules are declared without the global flag. */
  const global = pattern.global
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`)
  return [...content.matchAll(global)]
}
