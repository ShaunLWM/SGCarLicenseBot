import { Document, Model, model, Schema, Types } from "mongoose";

export interface ICarImage {
  name: string;
  raw: string;
}

const CarImageSchemaFields: Record<keyof ICarImage, any> = {
  name: {
    type: String,
    required: true,
    unique: true,
  },
  raw: {
    type: String,
  }
};

const ICarImageSchema = new Schema<ICarImageDocument, ICarImageModel>(CarImageSchemaFields);

export interface ICarImageDocument extends ICarImage, Document { }

ICarImageSchema.statics.getUniqueLicensePlatesCount = async function (): Promise<number> {
  return await this.distinct("carId").count().exec();
};

export interface ICarImageModel extends Model<ICarImageDocument> {
  getUniqueLicensePlatesCount(): Promise<number>;
}

export default model<ICarImageDocument, ICarImageModel>("CarImage", ICarImageSchema);
