import { hash, verify, type Options } from '@node-rs/argon2';

// argon2id m=64MB t=3 p=1 (06-auth.md §2, spike 06: 41 ms verify on the VM).
// `algorithm: 2` is Algorithm.Argon2id (a const enum, not importable under verbatimModuleSyntax).
const options: Options = { algorithm: 2 as Options['algorithm'], memoryCost: 65536, timeCost: 3, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, options);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Verified against for unknown emails so response time does not reveal whether an account exists.
let dummyHash: Promise<string> | undefined;
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-0');
  await verifyPassword(await dummyHash, password);
}
