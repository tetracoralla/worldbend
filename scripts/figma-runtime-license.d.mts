export function assertFigmaRuntimeLockIdentity(lock:string,version:string):void;
export function readFigmaRuntimeLicense():{version:string;license:Buffer;copyright:string;lock:string};
export function licenseComment(license:string,label:string):string;
export function figmaRuntimeLicenseBanner():string;
