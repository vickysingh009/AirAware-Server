import axios from 'axios';
const SERVER = 'http://10.47.36.61:4000';

 // change to your server address

export async function fetchAQ(lat, lon) {
  const res = await axios.get(`${SERVER}/api/aq?lat=${lat}&lon=${lon}`);
  return res.data;
}
