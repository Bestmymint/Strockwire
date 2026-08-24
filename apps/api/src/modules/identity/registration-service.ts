import type { PasswordHasher } from "./password-hasher.ts";
import type { RegistrationRepository } from "./registration-repository.ts";

export interface RegistrationInput {
  email: string;
  password: string;
}

export interface RegistrationService {
  register(input: RegistrationInput): Promise<void>;
}

export function createRegistrationService({
  passwordHasher,
  repository,
}: {
  passwordHasher: PasswordHasher;
  repository: RegistrationRepository;
}): RegistrationService {
  return {
    async register({ email, password }) {
      const passwordHash = await passwordHasher.hash(password);
      await repository.createUnverifiedUser({ email, passwordHash });
    },
  };
}
