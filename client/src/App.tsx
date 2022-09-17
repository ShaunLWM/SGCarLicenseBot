import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import Homepage from './page/Homepage';
import { BrowserRouter, Routes, Route } from "react-router-dom";
import CarsResults from './page/CarsResults';

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReactQueryDevtools initialIsOpen={false} />
      <BrowserRouter>
        <Routes>
          <Route path="/">
            <Route index element={<Homepage />} />
          </Route>
          <Route path="/:id" element={<CarsResults />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
