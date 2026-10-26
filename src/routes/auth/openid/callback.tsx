import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseSsoCallbackSearch, resolveSsoCallback } from '@/utils';
import { SsoError } from '@/components/SsoError';
import { oauthExchangeFn } from '@/server';

export const Route = createFileRoute('/auth/openid/callback')({
  validateSearch: parseSsoCallbackSearch,
  loaderDeps: ({ search }) => ({ code: search.code, error: search.error }),
  loader: async ({ deps }) => {
    const failure = await resolveSsoCallback(deps, (code) => oauthExchangeFn({ data: { code } }));
    if (!failure) throw redirect({ to: '/' });
    return { code: failure };
  },
  component: OpenIdCallback,
});

function OpenIdCallback() {
  const { code } = Route.useLoaderData();
  return <SsoError code={code} />;
}
