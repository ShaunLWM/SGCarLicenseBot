import { Document, Model, model, Schema } from "mongoose";

export interface ISearchTerm {
  term: string;
  registrationDate: string;
  itemsPerPage: number;
  yearFrom: number;
  yearTo: number;
}

const ISearchTermSchemaFields: Record<keyof ISearchTerm, any> = {
  term: {
    type: String,
    required: true,
  },
  registrationDate: {
    type: String,
    default: "0",
  },
  itemsPerPage: {
    type: Number,
    default: 20,
  },
  yearFrom: {
    type: Number,
    default: 0,
  },
  yearTo: {
    type: Number,
    default: 0,
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
