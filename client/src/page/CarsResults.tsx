import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import React from 'react'
import { useParams } from 'react-router-dom';

interface CarItem {
  carId: string
  createdAt: string;
  data: string;
  name: string;
  searchId: string;
  updatedAt: string;
  _id: string;
}


const getCarsByTerm = async (key: string) => {
  const { data } = await axios.get<{ data: CarItem[] }>(`http://localhost:3000/${key}`);
  return data.data;
};

function useCars(termId: string) {
  return useQuery(["term", termId], () => getCarsByTerm(termId), { enabled: !!termId });
}

export default function CarsResults() {
  let { id = '' } = useParams();
  const { isLoading, error, data } = useCars(id);

  if (isLoading) return <div>Loading...</div>;

  if (error) return <div>An error has occurred</div>;

  console.log(data);

  return (
    <div>
      <div>
        {data?.map((item) => <div key={item._id}>{item.name}</div>)}
      </div>
    </div>
  )
}
