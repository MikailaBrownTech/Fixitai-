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
  const op = resources.SearchApi.Properties.DefinitionBody.paths['/search'].post;
  const schema = resources.SearchApi.Properties.DefinitionBody.components.schemas.SearchRequest;

  it('uses a REST API with the body validator switched on for POST /search', () => {
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

  it('wires POST /search to the Lambda function (a proxy integration declared in the template)', () => {
    const integration = op['x-amazon-apigateway-integration'];
    expect(integration.type).toBe('aws_proxy');
    expect(integration.httpMethod).toBe('POST');
    expect(integration.uri['Fn::Sub']).toContain('lambda:path/2015-03-31/functions/${SearchFunction.Arn}/invocations');
  });

  it('exposes only POST /search', () => {
    const paths = resources.SearchApi.Properties.DefinitionBody.paths;
    expect(Object.keys(paths)).toEqual(['/search']);
    expect(Object.keys(paths['/search'])).toEqual(['post']);
    expect(resources.SearchFunction.Properties.Events.Search.Properties).toMatchObject({ Path: '/search', Method: 'POST' });
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
