import { Document, Model, model, Schema, Types } from "mongoose";

export interface ITrackedCar {
  carId: string;
  name: string;
  data: string;
  searchId: Types.ObjectId;
}

const CarSchemaFields: Record<keyof ITrackedCar, any> = {
  carId: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    required: true,
  },
  data: {
    type: String,
  },
  searchId: {
    type: Schema.Types.ObjectId,
  }
};

const ITrackedCarSchema = new Schema<ITrackedCarDocument, ITrackedCarModel>(CarSchemaFields);

export interface ITrackedCarDocument extends ITrackedCar, Document { }

ITrackedCarSchema.statics.getUniqueLicensePlatesCount = async function (): Promise<number> {
  return await this.distinct("carId").count().exec();
};

export interface ITrackedCarModel extends Model<ITrackedCarDocument> {
  getUniqueLicensePlatesCount(): Promise<number>;
}

export default model<ITrackedCarDocument, ITrackedCarModel>("TrackedCar", ITrackedCarSchema);
