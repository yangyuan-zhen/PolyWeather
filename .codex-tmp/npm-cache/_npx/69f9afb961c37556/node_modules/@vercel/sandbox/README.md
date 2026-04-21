# Vercel Sandbox

Vercel Sandbox allows you to run arbitrary code in isolated, ephemeral Linux
VMs. View the documentation [here](https://vercel.com/docs/vercel-sandbox).

## Packages

- [`@vercel/sandbox`](https://www.npmjs.com/package/@vercel/sandbox) (this package) - The SDK for programmatic access to Vercel Sandbox. [Source](https://github.com/vercel/sandbox/tree/main/packages/vercel-sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/sdk-reference)
- [`sandbox`](https://www.npmjs.com/package/sandbox) - The CLI for interacting with Vercel Sandbox from the command line. [Source](https://github.com/vercel/sandbox/tree/main/packages/sandbox) | [Documentation](https://vercel.com/docs/vercel-sandbox/cli-reference)

## What is a sandbox?

A sandbox is an isolated Linux system for your experimentation and use.
Internally, it is a Firecracker MicroVM that is powered by [the same
infrastructure][hive] that powers 2M+ builds a day at Vercel.

## Getting started

To get started using Node.js 22+, create a new project:

```sh
mkdir my-sandbox-app && cd my-sandbox-app
npm init -y
vercel link
```

Pull your authentication token:

```sh
vercel env pull
```

Install the Sandbox SDK:

```sh
pnpm i @vercel/sandbox
```

Create a `index.mts` file:

```ts
import { Sandbox } from "@vercel/sandbox";
import { setTimeout } from "timers/promises";
import { spawn } from "child_process";

async function main() {
  const sandbox = await Sandbox.create({
    source: {
      url: "https://github.com/vercel/sandbox-example-next.git",
      type: "git",
    },
    resources: { vcpus: 4 },
    ports: [3000],
    runtime: "node24",
  });

  console.log(`Installing dependencies...`);
  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--loglevel", "info"],
    stderr: process.stderr,
    stdout: process.stdout,
  });

  if (install.exitCode != 0) {
    console.log("installing packages failed");
    process.exit(1);
  }

  console.log(`Starting the development server...`);
  await sandbox.runCommand({
    cmd: "npm",
    args: ["run", "dev"],
    stderr: process.stderr,
    stdout: process.stdout,
    detached: true,
  });

  await setTimeout(500);
  spawn("open", [sandbox.domain(3000)]);
}

main().catch(console.error);
```

Run it:

```sh
node --experimental-strip-types --env-file .env.local index.mts
```

This will:

- Start a sandbox, seeding it with a git repository.
- Install dependencies.
- Run a `next dev` server
- Open it in your browser

All while streaming logs to your local terminal.

## Authentication

### Vercel OIDC token

The SDK uses Vercel OIDC tokens to authenticate whenever available. This is the
most straightforward and recommended way to authenticate.

When developing locally, you can download a development token to `.env.local`
using `vercel env pull`. After 12 hours the development token expires, meaning
you will have to call `vercel env pull` again.

In production, Vercel manages token expiration for you.

### Access token

If you want to use the SDK from an environment where `VERCEL_OIDC_TOKEN` is
unavailable, you can also authenticate using an access token:

- Go to your team settings, and copy the team ID.
- Go to a project's settings, and copy the project ID.
- Go to your Vercel account settings and [create a token][create-token]. Make
  sure it is scoped to the team ID from the previous step.

Set your team ID, project ID, and token to the environment variables
`VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`. Then pass these to
the `create` method:

```ts
const sandbox = await Sandbox.create({
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
  token: process.env.VERCEL_TOKEN!,
  source: {
    url: "https://github.com/vercel/sandbox-example-next.git",
    type: "git",
  },
  resources: { vcpus: 4 },
  // Defaults to 5 minutes. The maximum is 5 hours for Pro/Enterprise, and 45 minutes for Hobby.
  timeout: ms("5m"),
  ports: [3000],
  runtime: "node24",
});
```

## Limitations

- Max resources: 8 vCPUs. You will get 2048 MB of memory per vCPU.
- Sandboxes have a maximum runtime duration of 5 hours for Pro/Enterprise and 45 minutes for Hobby,
  with a default of 5 minutes. This can be configured using the `timeout` option of `Sandbox.create()`.

## System

The base system is an Amazon Linux 2023 system with the following additional
packages installed.

```
bind-utils
bzip2
findutils
git
gzip
iputils
libicu
libjpeg
libpng
ncurses-libs
openssl
openssl-libs
procps
tar
unzip
which
whois
zstd
```

- The `node24` and `node22` images ship Node runtimes under `/vercel/runtimes/node{22,24}`.
- The `python3.13` image ships a Python 3.13 runtime under `/vercel/runtimes/python`.
- User code is executed as the `vercel-sandbox` user.
- `/vercel/sandbox` is writable.

## Sudo access

The `nodeX` and `python3.13` images allow users to run commands as root. This
can be used to install packages and system tools:

```typescript
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create();
await sandbox.runCommand({
  cmd: "dnf",
  args: ["install", "-y", "golang"],
  sudo: true,
});
```

Sandbox runs sudo in the following configuration:

- `HOME` is set to `/root` – Executed commands will source root's configuration
  files (e.g. `.gitconfig`, `.bashrc`, etc).
- Environment variables are not reset before executing the command.
- `PATH` is left unchanged – sudo won't change the value of PATH, so local or
  project-specific binaries will still be found.

Both these images are based on Amazon Linux 2023. The full package list is
available [here](https://docs.aws.amazon.com/linux/al2023/release-notes/all-packages-AL2023.7.html).

[create-token]: https://vercel.com/account/settings/tokens
[hive]: https://vercel.com/blog/a-deep-dive-into-hive-vercels-builds-infrastructure
[al-2023-packages]: https://docs.aws.amazon.com/linux/al2023/release-notes/all-packages-AL2023.7.html

## Authors

This library is created by [Vercel](https://vercel.com) team members, with contributions from the [Open Source Community](https://github.com/vercel/sandbox/graphs/contributors) welcome and highly appreciated.
