export type SampleWord = {
  id: number;
  text: string;
  start: number;
  end: number;
  rms: number;
};

export type SampleSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  words: SampleWord[];
};

const baseWords: SampleWord[] = [
  { id: 0, text: "This", start: 0.0, end: 0.6, rms: 0.9 },
  { id: 1, text: "is", start: 0.6, end: 1.2, rms: 0.7 },
  { id: 2, text: "a", start: 1.2, end: 1.8, rms: 0.4 },
  { id: 3, text: "sample", start: 1.8, end: 2.4, rms: 0.95 },
  { id: 4, text: "video", start: 2.4, end: 3.0, rms: 0.6 },
  { id: 5, text: "to", start: 3.6, end: 4.0, rms: 0.35 },
  { id: 6, text: "preview", start: 4.0, end: 4.7, rms: 0.85 },
  { id: 7, text: "OneSub", start: 4.7, end: 5.4, rms: 0.8 },
  { id: 8, text: "styled", start: 5.4, end: 6.0, rms: 0.5 },
  { id: 9, text: "captions", start: 6.0, end: 6.6, rms: 0.88 },
  { id: 10, text: "with", start: 6.6, end: 7.2, rms: 0.45 },
  { id: 11, text: "loudness", start: 7.2, end: 8.0, rms: 0.92 }
];

export const sampleTranscript: { segments: SampleSegment[] } = {
  segments: [
    {
      id: 1,
      start: 0,
      end: 3.2,
      text: "This is a sample video",
      words: baseWords.filter((word) => word.id <= 4)
    },
    {
      id: 2,
      start: 3.6,
      end: 6.6,
      text: "to preview OneSub styled captions",
      words: baseWords.filter((word) => word.id >= 5 && word.id <= 9)
    },
    {
      id: 3,
      start: 6.6,
      end: 8.2,
      text: "with loudness",
      words: baseWords.filter((word) => word.id >= 10)
    }
  ]
};
