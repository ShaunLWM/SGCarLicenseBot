import { Document, Model, model, Schema } from "mongoose";

export const RowItemType = ["liquidity", "freezer", "staking", "lending", "pricing"];

export interface IRowItemData {
  type: "liquidity" | "freezer" | "staking" | "lending" | "pricing";
  date: Date;
  data: string;
}

export interface ICar {
  lastUpdated: Date;
  license: string;
  carMake: string;
  tax: string;
}

const CarSchemaFields: Record<keyof ICar, any> = {
  lastUpdated: {
    type: Date,
    required: true,
  },
  license: {
    type: String,
    required: true,
    index: true,
  },
  carMake: {
    type: String,
    required: true,
  },
  tax: {
    type: String,
    required: true,
  }
};

const CarSchema = new Schema<ICarDocument, ICarModel>(CarSchemaFields, {
  timestamps: false,
});

export interface ICarDocument extends ICar, Document { }

CarSchema.statics.getUniqueLicensePlatesCount = async function (): Promise<number> {
  return await this.distinct("address").count().exec();
};

export interface ICarModel extends Model<ICarDocument> {
  getUniqueLicensePlatesCount(): Promise<number>;
}

export default model<ICarDocument, ICarModel>("Car", CarSchema);
