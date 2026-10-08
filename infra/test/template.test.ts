import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { QUERY_MAX_LENGTH, QUERY_PATTERN } from '@fixitfast/shared';

/**
 * These tests read infra/template.yaml as data and check the security settings in it. They run
 * offline and cost nothing, so a careless edit to the template fails here, before any deploy.
 * (The template uses the long form of CloudFormation functions, such as "Fn::Sub", so a plain
 * YAML parser can read it.)
 */
// The template is arbitrary nested data, so these tests deliberately use loose typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tree = any;

const text = readFileSync(fileURLToPath(new URL('../template.yaml', import.meta.url)), 'utf8');
const template = parse(text) as Tree;
const resources = template.Resources as Tree;

describe('security tier 1: input constraints at the gateway', () => {
  const op = resources.SearchApi.Properties.DefinitionBody.paths['/api/search'].post;
  const schema = resources.SearchApi.Properties.DefinitionBody.components.schemas.SearchRequest;

  it('uses a REST API with the body validator switched on for POST /api/search', () => {
    const validators = resources.SearchApi.Properties.DefinitionBody['x-amazon-apigateway-request-validators'];
    expect(validators['body-only'].validateRequestBody).toBe(true);
    expect(op['x-amazon-apigateway-request-validator']).toBe('body-only');
    expect(op.requestBody.required).toBe(true);
  });

  it('limits the query to the same length as the shared code', () => {
    expect(schema.properties.query.maxLength).toBe(QUERY_MAX_LENGTH);
    expect(schema.properties.query.minLength).toBe(1);
  });

  it('uses exactly the same character filter as the shared code', () => {
    expect(schema.properties.query.pattern).toBe(QUERY_PATTERN.source);
  });

  it('requires "query" and rejects extra fields', () => {
    expect(schema.required).toEqual(['query']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('wires POST /api/search to the Lambda function (a proxy integration declared in the template)', () => {
    const integration = op['x-amazon-apigateway-integration'];
    expect(integration.type).toBe('aws_proxy');
    expect(integration.httpMethod).toBe('POST');
    expect(integration.uri['Fn::Sub']).toContain('lambda:path/2015-03-31/functions/${SearchFunction.Arn}/invocations');
  });

  it('exposes only POST /api/search', () => {
    const paths = resources.SearchApi.Properties.DefinitionBody.paths;
    expect(Object.keys(paths)).toEqual(['/api/search']);
    expect(Object.keys(paths['/api/search'])).toEqual(['post']);
    expect(resources.SearchFunction.Properties.Events.Search.Properties).toMatchObject({ Path: '/api/search', Method: 'POST' });
  });
});

describe('throttling (worst-case cost control)', () => {
  it('applies a rate and burst limit to every method', () => {
    const [setting] = resources.SearchApi.Properties.MethodSettings;
    expect(setting.ResourcePath).toBe('/*');
    expect(setting.HttpMethod).toBe('*');
    expect(setting.ThrottlingRateLimit).toEqual({ Ref: 'ThrottleRate' });
    expect(setting.ThrottlingBurstLimit).toEqual({ Ref: 'ThrottleBurst' });
  });

  it('defaults to small numbers, and cannot be set absurdly high without editing the template', () => {
    const { ThrottleRate, ThrottleBurst } = template.Parameters;
    expect(ThrottleRate.Default).toBeLessThanOrEqual(5);
    expect(ThrottleBurst.Default).toBeLessThanOrEqual(10);
    expect(ThrottleRate.MaxValue).toBeLessThanOrEqual(20);
    expect(ThrottleBurst.MaxValue).toBeLessThanOrEqual(40);
  });
});

describe('security tier 3: keys never reach the browser or the repo', () => {
  it('the API key is a NoEcho parameter with an empty default', () => {
    expect(template.Parameters.AnthropicApiKey.NoEcho).toBe(true);
    expect(template.Parameters.AnthropicApiKey.Default).toBe('');
  });

  it('no key-shaped string appears anywhere in the template', () => {
    expect(text).not.toMatch(/sk-ant-/i);
    expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });

  it('the key reaches the function only through the parameter, and the function has only these variables', () => {
    const vars = resources.SearchFunction.Properties.Environment.Variables;
    expect(Object.keys(vars).sort()).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'LLM_PROVIDER']);
    expect(vars.ANTHROPIC_API_KEY).toEqual({ Ref: 'AnthropicApiKey' });
  });

  it('defaults to the free mock provider', () => {
    expect(template.Parameters.LlmProvider.Default).toBe('mock');
  });

  it('the template never outputs the key', () => {
    expect(JSON.stringify(template.Outputs)).not.toContain('AnthropicApiKey');
  });
});

describe('security tier 5: least-privilege IAM', () => {
  const role = resources.SearchFunctionRole.Properties;
  const statements = role.Policies.flatMap((p: Tree) => p.PolicyDocument.Statement) as Tree[];

  it('the function uses our own role, not a broad managed policy', () => {
    expect(resources.SearchFunction.Properties.Role).toEqual({ 'Fn::GetAtt': ['SearchFunctionRole', 'Arn'] });
    expect(resources.SearchFunction.Properties.Policies).toBeUndefined();
    expect(role.ManagedPolicyArns).toBeUndefined();
  });

  it('only Lambda can assume the role', () => {
    const [stmt] = role.AssumeRolePolicyDocument.Statement;
    expect(stmt.Principal).toEqual({ Service: 'lambda.amazonaws.com' });
    expect(stmt.Action).toBe('sts:AssumeRole');
  });

  it('allows exactly two log actions and nothing else', () => {
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    expect(actions.sort()).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents']);
  });

  it('has no wildcard actions, no Deny-less surprises and no "*" resource', () => {
    for (const s of statements) {
      expect(s.Effect).toBe('Allow');
      for (const action of Array.isArray(s.Action) ? s.Action : [s.Action]) expect(action).not.toContain('*');
      expect(s.Resource).not.toBe('*');
    }
  });

  it('scopes the log permission to this function\'s own log group', () => {
    const resource: string = statements[0]!.Resource['Fn::Sub'];
    expect(resource).toContain('log-group:/aws/lambda/${AWS::StackName}-search:');
    expect(resource.endsWith(':*')).toBe(true);
    expect(resource.match(/\*/g)).toHaveLength(1); // the single trailing wildcard
  });

  it('creates the log group itself, with short retention', () => {
    expect(resources.SearchLogGroup.Properties.RetentionInDays).toEqual({ Ref: 'LogRetentionDays' });
    expect(template.Parameters.LogRetentionDays.Default).toBeLessThanOrEqual(14);
    expect(resources.SearchFunction.DependsOn).toBe('SearchLogGroup');
  });
});

describe('function settings', () => {
  const fn = resources.SearchFunction.Properties;

  it('uses a currently supported runtime and the bundled build output', () => {
    expect(fn.Runtime).toBe('nodejs24.x');
    expect(fn.CodeUri).toBe('../backend/dist/');
    expect(fn.Handler).toBe('index.handler');
  });

  it('has a timeout above the code\'s own budget (LLM 8 s + iFixit 4 s) and under the gateway\'s limit', () => {
    expect(fn.Timeout).toBeGreaterThanOrEqual(13);
    expect(fn.Timeout).toBeLessThanOrEqual(28);
  });

  it('is a regional API (no hidden extra CloudFront distribution)', () => {
    expect(resources.SearchApi.Properties.EndpointConfiguration.Type).toBe('REGIONAL');
  });
});

describe('website: private bucket behind CloudFront', () => {
  const bucket = resources.SiteBucket.Properties;
  const policy = resources.SiteBucketPolicy.Properties.PolicyDocument;
  const dist = resources.SiteDistribution.Properties.DistributionConfig;
  const headers = resources.SiteSecurityHeaders.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;

  it('the bucket blocks all public access and is not a public website', () => {
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.WebsiteConfiguration).toBeUndefined();
    expect(bucket.AccessControl).toBeUndefined();
    expect(bucket.OwnershipControls.Rules).toEqual([{ ObjectOwnership: 'BucketOwnerEnforced' }]);
  });

  it('the only bucket permission is: CloudFront may read objects, from this one distribution', () => {
    expect(policy.Statement).toHaveLength(1);
    const [stmt] = policy.Statement;
    expect(stmt.Effect).toBe('Allow');
    expect(stmt.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(stmt.Action).toBe('s3:GetObject'); // no list, no write, no delete
    expect(stmt.Resource).toEqual({ 'Fn::Sub': '${SiteBucket.Arn}/*' });
    expect(stmt.Condition.StringEquals['AWS:SourceArn']['Fn::Sub']).toContain('distribution/${SiteDistribution}');
  });

  it('CloudFront reaches S3 through a signed Origin Access Control', () => {
    const oac = resources.SiteOriginAccessControl.Properties.OriginAccessControlConfig;
    expect(oac).toMatchObject({ OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' });
    const site = dist.Origins.find((o: Tree) => o.Id === 'site');
    expect(site.OriginAccessControlId).toEqual({ 'Fn::GetAtt': ['SiteOriginAccessControl', 'Id'] });
    expect(site.S3OriginConfig.OriginAccessIdentity).toBe('');
  });

  it('pages: HTTPS only, read-only methods', () => {
    const b = dist.DefaultCacheBehavior;
    expect(b.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(b.AllowedMethods).toEqual(['GET', 'HEAD']);
    expect(b.TargetOriginId).toBe('site');
  });

  it('/api/* goes to the API over HTTPS, with caching off', () => {
    const [b] = dist.CacheBehaviors;
    expect(dist.CacheBehaviors).toHaveLength(1);
    expect(b.PathPattern).toBe('/api/*');
    expect(b.TargetOriginId).toBe('api');
    expect(b.ViewerProtocolPolicy).toBe('https-only');
    expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // managed CachingDisabled
    expect(b.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac'); // AllViewerExceptHostHeader
  });

  it('the API origin is this stack\'s API, stage "prod", HTTPS and TLS 1.2 only', () => {
    const api = dist.Origins.find((o: Tree) => o.Id === 'api');
    expect(api.DomainName['Fn::Sub']).toMatch(/^\$\{SearchApi\}\.execute-api\./);
    expect(api.OriginPath).toBe(`/${resources.SearchApi.Properties.StageName}`);
    expect(api.CustomOriginConfig.OriginProtocolPolicy).toBe('https-only');
    expect(api.CustomOriginConfig.OriginSSLProtocols).toEqual(['TLSv1.2']);
  });

  it('the frontend\'s path (/api/search) matches what CloudFront forwards to the API route', () => {
    const route = Object.keys(resources.SearchApi.Properties.DefinitionBody.paths)[0] as string;
    expect(route.startsWith('/api/')).toBe(true);
  });

  it('security headers apply to both the pages and the API', () => {
    const ref = { Ref: 'SiteSecurityHeaders' };
    expect(dist.DefaultCacheBehavior.ResponseHeadersPolicyId).toEqual(ref);
    expect(dist.CacheBehaviors[0].ResponseHeadersPolicyId).toEqual(ref);
  });

  it('sets HSTS for a year, no framing, no sniffing, no referrer', () => {
    expect(headers.StrictTransportSecurity.AccessControlMaxAgeSec).toBeGreaterThanOrEqual(31536000);
    expect(headers.FrameOptions.FrameOption).toBe('DENY');
    expect(headers.ContentTypeOptions.Override).toBe(true);
    expect(headers.ReferrerPolicy.ReferrerPolicy).toBe('no-referrer');
  });

  describe('Content Security Policy', () => {
    const csp: string = headers.ContentSecurityPolicy.ContentSecurityPolicy;
    const directives = Object.fromEntries(
      csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
      }),
    ) as Record<string, string[]>;

    it('locks everything to our own domain by default', () => {
      expect(directives['default-src']).toEqual(["'self'"]);
      expect(directives['connect-src']).toEqual(["'self'"]);
      expect(directives['object-src']).toEqual(["'none'"]);
      expect(directives['frame-ancestors']).toEqual(["'none'"]);
      expect(directives['base-uri']).toEqual(["'self'"]);
      expect(directives['form-action']).toEqual(["'self'"]);
    });

    it('allows inline scripts only (Next.js needs them), never eval, never other sites', () => {
      expect(directives['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
      expect(csp).not.toContain('unsafe-eval');
    });

    it('keeps styles strict', () => {
      expect(directives['style-src']).toEqual(["'self'"]);
    });

    it('has no wildcard or http: sources anywhere', () => {
      expect(csp).not.toMatch(/(^|\s)\*(\s|;|$)/);
      expect(csp).not.toMatch(/\bhttp:/);
    });
  });

  it('only missing-file errors are replaced with the 404 page, so API errors (400, 429...) pass through', () => {
    const codes = dist.CustomErrorResponses.map((e: Tree) => e.ErrorCode).sort();
    expect(codes).toEqual([403, 404]);
    for (const e of dist.CustomErrorResponses) expect(e.ResponseCode).toBe(404);
  });

  it('uses the cheapest edge set and the free default certificate', () => {
    expect(dist.PriceClass).toBe('PriceClass_100');
    expect(dist.ViewerCertificate).toEqual({ CloudFrontDefaultCertificate: true });
  });

  it('outputs the site address, bucket name and distribution id (and still no key)', () => {
    expect(Object.keys(template.Outputs).sort()).toEqual(['ApiUrl', 'DistributionId', 'FunctionName', 'SiteBucketName', 'SiteUrl']);
    expect(JSON.stringify(template.Outputs)).not.toContain('AnthropicApiKey');
  });
});
