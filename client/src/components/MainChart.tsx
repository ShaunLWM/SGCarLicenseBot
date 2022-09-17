import React from 'react'
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import 'chartjs-adapter-moment';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);
type ViewProps = React.ComponentProps<typeof Scatter>

export const options: ViewProps["options"] = {
  maintainAspectRatio: false,
  scales: {
    x: {
      type: "time",
      time: {
        unit: "month"
      }
    },
  },
};

export const data: ViewProps["data"] = {
  datasets: [
    {
      label: 'A dataset',
      data: [{
        x: '2021-11-06 23:39:30',
        y: 50
      }, {
        x: '2021-11-07 01:00:28',
        y: 60
      }, {
        x: '2021-11-07 09:00:28',
        y: 20
      }],
      backgroundColor: 'rgba(255, 99, 132, 1)',
    },
  ],
};

export default function MainChart() {
  return (
    <div><Scatter options={options} data={data} height={100} width={100} /></div>
  )
}
