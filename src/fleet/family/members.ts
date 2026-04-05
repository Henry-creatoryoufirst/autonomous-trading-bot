/**
 * Never Rest Capital — Family Member Manager
 * v11.0: CRUD operations for family members + config persistence
 *
 * Manages the family configuration file (family-config.json) which stores:
 * - Member definitions (id, name, CDP account name, risk profile)
 * - Risk profile definitions (aggressive, moderate, conservative)
 * - Global family trading settings
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import {
  FamilyConfig,
  FamilyMember,
  RiskProfileName,
  MemberStatus,
  DEFAULT_RISK_PROFILES,
} from '../types/family.js';

const CONFIG_FILE = process.env.PERSIST_DIR
  ? `${process.env.PERSIST_DIR}/family-config.json`
  : './logs/family-config.json';

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

function createDefaultConfig(): FamilyConfig {
  return {
    version: 1,
    members: [
      {
        id: 'henry',
        name: 'Henry',
        cdpAccountName: 'henry-trading-bot', // matches existing CDP account
        walletAddress: '0x55509AA76E2769eCCa5B4293359e3001dA16dd0F',
        riskProfile: 'AGGRESSIVE',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        note: 'Founder — original NVR wallet',
      },
    ],
    riskProfiles: { ...DEFAULT_RISK_PROFILES },
    settings: {
      enabled: process.env.FAMILY_TRADING_ENABLED === 'true',
      dryRun: process.env.FAMILY_DRY_RUN !== 'false', // default true for safety
      maxConcurrentTrades: 3,
      interMemberDelayMs: 2000,
    },
  };
}

// ============================================================================
// FAMILY MEMBER MANAGER
// ============================================================================

export class FamilyMemberManager {
  private config: FamilyConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  // --- Config Persistence ---

  private loadConfig(): FamilyConfig {
    try {
      if (existsSync(CONFIG_FILE)) {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as FamilyConfig;
        // Merge in any new default risk profiles that may have been added
        for (const [key, profile] of Object.entries(DEFAULT_RISK_PROFILES)) {
          if (!parsed.riskProfiles[key as RiskProfileName]) {
            parsed.riskProfiles[key as RiskProfileName] = profile;
          }
        }
        return parsed;
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Family config load failed: ${err.message} — using defaults`);
    }
    return createDefaultConfig();
  }

  save(): void {
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err: any) {
      console.error(`  ❌ Family config save failed: ${err.message}`);
    }
  }

  // --- Member CRUD ---

  getMembers(): FamilyMember[] {
    return this.config.members;
  }

  getActiveMembers(): FamilyMember[] {
    return this.config.members.filter(m => m.status === 'ACTIVE');
  }

  getMember(id: string): FamilyMember | undefined {
    return this.config.members.find(m => m.id === id);
  }

  addMember(params: {
    id: string;
    name: string;
    riskProfile: RiskProfileName;
    note?: string;
  }): FamilyMember {
    // Validate unique ID
    if (this.config.members.some(m => m.id === params.id)) {
      throw new Error(`Member "${params.id}" already exists`);
    }

    // Validate risk profile
    if (!this.config.riskProfiles[params.riskProfile]) {
      throw new Error(`Unknown risk profile: ${params.riskProfile}`);
    }

    const member: FamilyMember = {
      id: params.id,
      name: params.name,
      cdpAccountName: `nvr-${params.id}-trading`,
      walletAddress: '', // populated on first CDP call
      riskProfile: params.riskProfile,
      status: 'ONBOARDING',
      createdAt: new Date().toISOString(),
      note: params.note,
    };

    this.config.members.push(member);
    this.save();
    return member;
  }

  updateMemberStatus(id: string, status: MemberStatus): void {
    const member = this.getMember(id);
    if (!member) throw new Error(`Member "${id}" not found`);
    member.status = status;
    this.save();
  }

  updateMemberWallet(id: string, walletAddress: string): void {
    const member = this.getMember(id);
    if (!member) throw new Error(`Member "${id}" not found`);
    member.walletAddress = walletAddress;
    if (member.status === 'ONBOARDING' && walletAddress) {
      member.status = 'ACTIVE';
    }
    this.save();
  }

  updateMemberRiskProfile(id: string, profile: RiskProfileName): void {
    const member = this.getMember(id);
    if (!member) throw new Error(`Member "${id}" not found`);
    if (!this.config.riskProfiles[profile]) {
      throw new Error(`Unknown risk profile: ${profile}`);
    }
    member.riskProfile = profile;
    this.save();
  }

  removeMember(id: string): void {
    if (id === 'henry') {
      throw new Error('Cannot remove the founder account');
    }
    this.config.members = this.config.members.filter(m => m.id !== id);
    this.save();
  }

  // --- Risk Profiles ---

  getRiskProfile(name: RiskProfileName) {
    return this.config.riskProfiles[name];
  }

  getRiskProfiles() {
    return this.config.riskProfiles;
  }

  getMemberRiskProfile(memberId: string) {
    const member = this.getMember(memberId);
    if (!member) throw new Error(`Member "${memberId}" not found`);
    return this.config.riskProfiles[member.riskProfile];
  }

  // --- Settings ---

  getSettings() {
    return this.config.settings;
  }

  isEnabled(): boolean {
    return this.config.settings.enabled;
  }

  isDryRun(): boolean {
    return this.config.settings.dryRun;
  }

  setEnabled(enabled: boolean): void {
    this.config.settings.enabled = enabled;
    this.save();
  }

  setDryRun(dryRun: boolean): void {
    this.config.settings.dryRun = dryRun;
    this.save();
  }

  // --- Dashboard / API data ---

  toJSON() {
    return {
      version: this.config.version,
      members: this.config.members,
      riskProfiles: Object.fromEntries(
        Object.entries(this.config.riskProfiles).map(([k, v]) => [
          k,
          { name: v.name, label: v.label, description: v.description },
        ])
      ),
      settings: this.config.settings,
      memberCount: this.config.members.length,
      activeCount: this.getActiveMembers().length,
    };
  }
}

// Singleton
export const familyManager = new FamilyMemberManager();
