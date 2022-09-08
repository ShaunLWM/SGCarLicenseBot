import { Document, Model, model, Schema } from "mongoose";

export interface ISearchTerm {
  term: string;
}

const ISearchTermSchemaFields: Record<keyof ISearchTerm, any> = {
  term: {
    type: String,
    required: true,
  },
};

const ISearchTermSchema = new Schema<ISearchTermDocument, ISearchTermModel>(ISearchTermSchemaFields);

export interface ISearchTermDocument extends ISearchTerm, Document { }

ISearchTermSchema.statics.getUniqueLicensePlatesCount = async function (): Promise<number> {
  return await this.distinct("carId").count().exec();
};

export interface ISearchTermModel extends Model<ISearchTermDocument> {
  getUniqueLicensePlatesCount(): Promise<number>;
}

export default model<ISearchTermDocument, ISearchTermModel>("SearchTerm", ISearchTermSchema);
