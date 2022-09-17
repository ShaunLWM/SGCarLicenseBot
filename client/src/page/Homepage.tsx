import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react'
import axios from "axios";
import { useNavigate } from 'react-router-dom';
import MainChart from '../components/MainChart';

interface IResult {
  data: { _id: string, term: string }[]
}

export default function Homepage() {
  const navigate = useNavigate();
  const { isLoading, error, data } = useQuery<IResult>(["main"], () => axios.get("http://localhost:3000").then((res) => res.data));

  const onChosenItem = (id: string) => {
    navigate(`/${id}`);
  }

  if (isLoading) return <div>Loading...</div>;

  if (error) return <div>An error has occurred</div>;

  return (
    <div>
      <ul>{data?.data.map((item) => <li key={item._id} onClick={() => onChosenItem(item._id)}>{item.term}</li>)}</ul>
      <MainChart />
    </div>
  )
}
