type JoseKeyImportModule = typeof import("jose/key/import");
type JoseJwtSignModule = typeof import("jose/jwt/sign");

const joseKeyImportModulePromise =
  // @ts-expect-error We intentionally bypass the export map to load jose's browser/Web Crypto implementation.
  import("../node_modules/jose/dist/browser/key/import.js") as Promise<JoseKeyImportModule>;
const joseJwtSignModulePromise =
  // @ts-expect-error We intentionally bypass the export map to load jose's browser/Web Crypto implementation.
  import("../node_modules/jose/dist/browser/jwt/sign.js") as Promise<JoseJwtSignModule>;

export async function importPKCS8(...args: Parameters<JoseKeyImportModule["importPKCS8"]>) {
  const joseModule = await joseKeyImportModulePromise;
  return joseModule.importPKCS8(...args);
}

export class SignJWT {
  private readonly signJwtPromise: Promise<InstanceType<JoseJwtSignModule["SignJWT"]>>;

  constructor(payload: ConstructorParameters<JoseJwtSignModule["SignJWT"]>[0]) {
    this.signJwtPromise = joseJwtSignModulePromise.then(
      (module) => new module.SignJWT(payload)
    );
  }

  setProtectedHeader(
    ...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["setProtectedHeader"]>
  ) {
    this.signJwtPromise.then((instance) => instance.setProtectedHeader(...args));
    return this;
  }

  setIssuer(...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["setIssuer"]>) {
    this.signJwtPromise.then((instance) => instance.setIssuer(...args));
    return this;
  }

  setIssuedAt(...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["setIssuedAt"]>) {
    this.signJwtPromise.then((instance) => instance.setIssuedAt(...args));
    return this;
  }

  setAudience(...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["setAudience"]>) {
    this.signJwtPromise.then((instance) => instance.setAudience(...args));
    return this;
  }

  setExpirationTime(
    ...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["setExpirationTime"]>
  ) {
    this.signJwtPromise.then((instance) => instance.setExpirationTime(...args));
    return this;
  }

  async sign(...args: Parameters<InstanceType<JoseJwtSignModule["SignJWT"]>["sign"]>) {
    const instance = await this.signJwtPromise;
    return instance.sign(...args);
  }
}
