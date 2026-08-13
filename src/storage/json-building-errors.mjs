export class BuildingNotFoundError extends Error {
  constructor() {
    super("Bino topilmadi");
    this.name = "BuildingNotFoundError";
    this.code = "BUILDING_NOT_FOUND";
  }
}

export class BuildingConflictError extends Error {
  constructor() {
    super("Bu bino boshqa oynada o‘zgartirilgan");
    this.name = "BuildingConflictError";
    this.code = "BUILDING_CONFLICT";
  }
}

export class BuildingPublishError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildingPublishError";
    this.code = "BUILDING_PUBLISH_INVALID";
  }
}
