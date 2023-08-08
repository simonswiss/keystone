import type { KeystoneDbAPI } from '@keystone-6/core/types';
import type { SecretFieldImpl } from '../types';

async function counterTimingAttack (secretFieldImpl: SecretFieldImpl) {
  await secretFieldImpl.generateHash('simulated-password-to-counter-timing-attack');
  return null;
}

export async function validateSecret(
  secretFieldImpl: SecretFieldImpl,
  identityField: string,
  identity: string,
  secretField: string,
  secret: string,
  dbItemAPI: KeystoneDbAPI<any>[string]
) {
  const item: {
    id: any;
    [prop: string]: any
  } | null = await dbItemAPI.findOne({
    where: {
      [identityField]: identity
    }
  });

  const hash = item?.[secretField];
  if (!item || !hash) return await counterTimingAttack(secretFieldImpl);

  const result = await secretFieldImpl.compare(secret, hash);
  if (result) return item;
  return null;
}
