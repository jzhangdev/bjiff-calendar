import got from "got";
import * as ics from 'ics';
import { format, fromUnixTime } from 'date-fns'
import { DateArray } from "ics";
import PQueue from 'p-queue';
import fs from 'fs-extra'

interface MovieData {
  id: string;
  theatreId: string;
  movieId: string;
  movieName: string;
};

interface AllMoviesData {
  data: {
    theatreSubLayerList: {
      theatreMovieList: MovieData[]
    }[]
  }[]
};

interface MovieScheduleData extends MovieData {
  cinemaName: string;
  cityName: string;
  cinemaAddress: string;
  hallName: string;
  showTime: number;
  showEndTime: number;
  meetingInfo: string;
};

interface MovieSchedulesData {
  data: {
    showDate: Date;
    showList: MovieScheduleData[]
  }[];
};


const fetchAllMovies = async () => {
  const resp = await got(
    "https://mt-m.maoyan.com/mtrade/film-festival/home/getTheatreMovieInfo?theatreId=97"
  ).json<AllMoviesData>();

  const allMovies = resp.data.reduce((acc, recommendationItem) => {
    recommendationItem.theatreSubLayerList.forEach((theatreSubLayerItem) => {
      theatreSubLayerItem.theatreMovieList.forEach((movie) => {
        acc.push(movie)
      })
    })
    return acc;
  }, []);

  return allMovies;
};

const fetchMovieSchedules = async (theatreId: MovieData['theatreId'], movieId: MovieData['movieId']) => {
  const resp = await got('https://mt-m.maoyan.com/mtrade/filmfestival/getMovieShowInfo', {
    searchParams: {
      theatreId,
      movieId,
    }
  }).json<MovieSchedulesData>();
  return resp.data;
};

const formatEventDateTime = (dateTime: number) => format(fromUnixTime(dateTime / 1000), 'yyyy-M-d-H-m').split('-').map((item) => Number(item)) as DateArray

const generateEventData = (movieSchedule: MovieScheduleData): ics.EventAttributes => ({
  title: movieSchedule.movieName,
  description: `${movieSchedule.cinemaName} ${movieSchedule.hallName}`,
  start: formatEventDateTime(movieSchedule.showTime),
  end: formatEventDateTime(movieSchedule.showEndTime),
  categories: [movieSchedule.cinemaName],
  status: 'CONFIRMED',
  busyStatus: 'BUSY',
  location: `${movieSchedule.cinemaName} ${movieSchedule.cityName}${movieSchedule.cinemaAddress}`,
});

(async () => {
  const queue = new PQueue({ concurrency: 5 });
  const allSchedules: MovieScheduleData[] = [];

  const allMovies = await fetchAllMovies();
  allMovies.forEach(movie => {
    queue.add(() => fetchMovieSchedules(movie.theatreId, movie.movieId))
  });

  queue.on('completed', (data: MovieSchedulesData['data']) => {
    data.forEach((item) => {
      item.showList.forEach((movieSchedule) => {
        allSchedules.push(movieSchedule);
      })
    });
  });

  queue.on('idle', async () => {
    const generatedEvents = ics.createEvents(allSchedules.map((schedule) => generateEventData(schedule)));
    if (generatedEvents.error) {
      throw generatedEvents.error;
    } else {
      const outputDir = './dist';
      const outputFilename = 'bjiff.ics';
      await fs.emptyDir(outputDir);
      await fs.writeFile(`${outputDir}/${outputFilename}`, generatedEvents.value);
    }
  });
})();
