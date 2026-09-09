/**
 * SecretSanitizer
 * Engine for detecting and redacting sensitive secrets (API Keys, Passwords, Tokens, Private Keys, Connection Strings)
 * from prompts, AI responses, terminal outputs, and tool call payloads.
 */
export class SecretSanitizer {
  private static readonly BUILT_IN_RULES: Array<{ name: string; regex: RegExp; replace: string | ((substring: string, ...args: any[]) => string) }> = [
    // Private Key blocks (RSA, EC, OpenSSH, PGP)
    {
      name: 'Private Key Block',
      regex: /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY[ A-Z0-9_-]*-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY[ A-Z0-9_-]*-----/g,
      replace: '[REDACTED_PRIVATE_KEY_BLOCK]'
    },
    // Google / Gemini API Keys
    {
      name: 'Google / Gemini API Key',
      regex: /\bAIza[0-9A-Za-z-_]{30,45}\b/g,
      replace: '[REDACTED_GOOGLE_API_KEY]'
    },
    // OpenAI API Keys (legacy sk-... and newer project-scoped sk-proj-...)
    {
      name: 'OpenAI API Key',
      regex: /\bsk-(?:proj-)?[a-zA-Z0-9-_]{20,}\b/g,
      replace: '[REDACTED_OPENAI_API_KEY]'
    },
    // Anthropic API Keys
    {
      name: 'Anthropic API Key',
      regex: /\bsk-ant-[a-zA-Z0-9-_]{20,}\b/g,
      replace: '[REDACTED_ANTHROPIC_API_KEY]'
    },
    // AWS Access Key ID
    {
      name: 'AWS Access Key ID',
      regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
      replace: '[REDACTED_AWS_ACCESS_KEY_ID]'
    },
    // GitHub Personal Access Token (classic & fine-grained)
    {
      name: 'GitHub Token',
      regex: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,}|gho_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36})\b/g,
      replace: '[REDACTED_GITHUB_TOKEN]'
    },
    // GitLab Personal Access Token
    {
      name: 'GitLab Token',
      regex: /\bglpat-[a-zA-Z0-9_-]{20,}\b/g,
      replace: '[REDACTED_GITLAB_TOKEN]'
    },
    // Slack Tokens
    {
      name: 'Slack Token',
      regex: /\bxox[baprs]-[0-9a-zA-Z]{10,}-[0-9a-zA-Z]{10,}(?:-[0-9a-zA-Z]+)?\b/g,
      replace: '[REDACTED_SLACK_TOKEN]'
    },
    // Stripe Secret Keys
    {
      name: 'Stripe Secret Key',
      regex: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
      replace: '[REDACTED_STRIPE_KEY]'
    },
    // JSON Web Token (JWT)
    {
      name: 'JWT Token',
      regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      replace: '[REDACTED_JWT_TOKEN]'
    },
    // Bearer / Basic Authorization Headers or values
    {
      name: 'Authorization Header',
      regex: /(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\r\n,;'"}\s]+/gi,
      replace: '$1[REDACTED_AUTH_TOKEN]'
    },
    // Generic Bearer Token in raw text
    {
      name: 'Generic Bearer Token',
      regex: /\bBearer\s+[a-zA-Z0-9\-\._~\+\/]{15,}=*/gi,
      replace: 'Bearer [REDACTED_BEARER_TOKEN]'
    },
    // Database Connection Strings with Credentials (e.g. postgres://user:password@host:5432/db)
    {
      name: 'Database URI Credentials',
      regex: /\b((?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|couchdb|amqp):\/\/)([^:\s\/]+):([^\s\/@]+(?:%40|[^\s\/@])*)@([^\s\/]+)/gi,
      replace: '$1[USER]:[REDACTED_PASSWORD]@$4'
    },
    // CLI Flags & Key-Value Pairs with Passwords / Secrets
    {
      name: 'Password Parameter',
      regex: /((?:--password|-p|password|passwd|pwd|db_password|api_key|apikey|secret|client_secret|access_token|auth_token)(?:[=:]|\s+)["']?)([^"'\s&;,]{3,})(["']?)/gi,
      replace: (match: string, p1: string, p2: string, p3: string) => {
        // Avoid masking standard variable declarations, options flags, or help commands
        if (/^\$[A-Z0-9_]+$/i.test(p2) || p2.startsWith('process.env') || p2.startsWith('-')) {
          return match;
        }
        return `${p1}[REDACTED_SECRET]${p3}`;
      }
    }
  ];

  /**
   * Sanitizes a string by detecting and redacting sensitive data.
   * @param text The input text to clean
   * @param customPatterns Optional user-defined regex strings to mask
   */
  public static sanitize(text: string, customPatterns: string[] = []): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let sanitized = text;

    // Apply built-in rules
    for (const rule of SecretSanitizer.BUILT_IN_RULES) {
      sanitized = sanitized.replace(rule.regex, rule.replace as any);
    }

    // Apply custom patterns if provided
    if (customPatterns && customPatterns.length > 0) {
      for (const patternStr of customPatterns) {
        if (!patternStr || !patternStr.trim()) continue;
        try {
          const customRegex = new RegExp(patternStr, 'g');
          sanitized = sanitized.replace(customRegex, '[REDACTED_CUSTOM_SECRET]');
        } catch (err) {
          console.warn(`Invalid custom secret pattern regex: "${patternStr}"`, err);
        }
      }
    }

    return sanitized;
  }

  /**
   * Recursively sanitizes any strings contained within an object or array.
   */
  public static sanitizeObject<T>(obj: T, customPatterns: string[] = []): T {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return SecretSanitizer.sanitize(obj, customPatterns) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => SecretSanitizer.sanitizeObject(item, customPatterns)) as unknown as T;
    }

    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const key of Object.keys(obj)) {
        result[key] = SecretSanitizer.sanitizeObject((obj as any)[key], customPatterns);
      }
      return result as unknown as T;
    }

    return obj;
  }
}
