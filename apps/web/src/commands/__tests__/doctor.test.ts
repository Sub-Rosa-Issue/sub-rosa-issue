import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { DoctorCommand } from '../doctor';

vi.mock('fs');

describe('Keeper Doctor Command Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should pass given an optimal and valid minimal environment configuration', async () => {
    process.env.KEEPER_RPC_URL = 'https://localhost:8545';
    process.env.CONTRACT_ARTIFACT_PATH = '/mock/valid.json';
    process.env.NETWORK_PASSPHRASE = 'Test Net';
    delete process.env.DRAND_ENDPOINT_URL;
    delete process.env.PERSISTENCE_PATH;

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ abi: [] }));

    await DoctorCommand.parseAsync(['node', 'doctor']);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('should fail validation when critical RPC configuration variables are missing', async () => {
    delete process.env.KEEPER_RPC_URL;
    process.env.CONTRACT_ARTIFACT_PATH = '/mock/valid.json';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');

    await DoctorCommand.parseAsync(['node', 'doctor']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should fail when artifact file paths do not exist', async () => {
    process.env.KEEPER_RPC_URL = 'https://localhost:8545';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await DoctorCommand.parseAsync(['node', 'doctor']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should fail when RPC URL is malformed', async () => {
    process.env.KEEPER_RPC_URL = 'invalid-url-format';
    process.env.CONTRACT_ARTIFACT_PATH = '/mock/valid.json';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');

    await DoctorCommand.parseAsync(['node', 'doctor']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should fail when Drand URL is malformed', async () => {
    process.env.KEEPER_RPC_URL = 'https://localhost:8545';
    process.env.DRAND_ENDPOINT_URL = 'not-a-url';
    process.env.CONTRACT_ARTIFACT_PATH = '/mock/valid.json';
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('{}');

    await DoctorCommand.parseAsync(['node', 'doctor']);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});