// Information storage and retrieval about the current user
//
// Right now we only support a single logged in user

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as mkdirp from "mkdirp";

import { environments } from "./environments";
import { profileFile, getProfileDir } from "../misc";
import { TokenValueType, tokenStore } from "../token-store";

const debug = require("debug")("mobile-center-cli:util:profile:profile");

export interface UpdatableProfile {
  userId: string;
  userName: string;
  displayName: string;
  email: string;
  environment: string;
  readonly accessTokenId: Promise<string>;
  readonly endpoint: string;
  defaultApp?: DefaultApp;
}

export interface Profile extends UpdatableProfile {
  readonly accessToken: Promise<TokenValueType>;
  save(): Profile;
  logout(): Promise<void>;
}

export interface DefaultApp {
  ownerName: string;
  appName: string;
  identifier: string;
}

class ProfileImpl implements Profile {
  userId: string;
  userName: string;
  displayName: string;
  email: string;
  environment: string;
  defaultApp?: DefaultApp;

  get accessTokenId(): Promise<string> {
    return tokenStore.get(this.userName)
      .then(entry => entry.accessToken.id);
  }

  get accessToken(): Promise<string> {
    return tokenStore.get(this.userName)
      .then(entry => entry.accessToken.token);
  }

  get endpoint(): string {
    return environments(this.environment).endpoint;
  }

  constructor(fileContents: any) {
    // This is slightly convoluted since file and API use different field names
    // TODO: Normalize to match them up?
    this.userId = fileContents.userId || fileContents.id;
    this.userName = fileContents.userName || fileContents.name;
    this.displayName = fileContents.displayName;
    this.email = fileContents.email;
    this.environment = fileContents.environment;
    this.defaultApp = fileContents.defaultApp;
  }

  save(): Profile {
    let profile: any = {
      userId: this.userId,
      userName: this.userName,
      displayName: this.displayName,
      email: this.email,
      environment: this.environment,
      defaultApp: this.defaultApp
    };

    mkdirp.sync(getProfileDir());
    fs.writeFileSync(getProfileFilename(), JSON.stringify(profile), { encoding: "utf8" });
    return this;
  }

  setAccessToken(token: TokenValueType): Promise<Profile> {
    return tokenStore.set(this.userName, token).then(() => this);
  }

  async logout(): Promise<void> {
    await tokenStore.remove(this.userName);
    try {
      fs.unlinkSync(getProfileFilename());
    } catch (err) {
      if (err.code !== "ENOENT") {
        // File not found is fine, anything else pass on the error
        throw err;
      }
    }
  }
}

const validApp = /^([a-zA-Z0-9-_.]{1,100})\/([a-zA-Z0-9-_.]{1,100})$/;

export function toDefaultApp(app: string): DefaultApp {
  const matches = app.match(validApp);
  if (matches !== null) {
    return {
      ownerName: matches[1],
      appName: matches[2],
      identifier: `${matches[1]}/${matches[2]}`
    };
  }
  return null;
}

let currentProfile: Profile = null;

function fileExists(filename: string): boolean {
  try {
    return fs.statSync(filename).isFile();
  }
  catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }
  return false;
}

function getProfileFilename(): string {
  const profileDir = getProfileDir();
  return path.join(profileDir, profileFile);
}

function loadProfile(): Profile {
  const profilePath = getProfileFilename();
  debug(`Loading profile from ${profilePath}`);
  if (!fileExists(profilePath)) {
    debug("No profile file exists");
    return null;
  }

  debug("Profile file loaded");
  let profileContents = fs.readFileSync(profilePath, "utf8");
  let profile: any = JSON.parse(profileContents);
  return new ProfileImpl(profile);
}

export function getUser(): Profile {
  debug("Getting current user from profile");
  if (!currentProfile) {
    debug("No current user, loading from file");
    currentProfile = loadProfile();
  }
  return currentProfile;
}

export function saveUser(user: any, token: TokenValueType, environment: string ): Promise<Profile> {
  return tokenStore.set(user.name, token)
    .then(() => {
      let profile = new ProfileImpl(Object.assign({}, user, { environment: environment }));
      profile.save();
      return profile;
    });
}

export async function deleteUser(): Promise<void> {
  let profile = getUser();
  if (profile) {
    return profile.logout();
  }
}
