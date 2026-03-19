import Head from 'next/head';
import '../index.css';
import '../App.css';
import '../components/Dashboard.css';
import '../components/PipCalculator.css';
import '../components/TradeCard.css';
import '../components/TradeForm.css';
import '../components/TradeHistory.css';

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="description" content="Forex Trade P/L Tracker" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
        <title>FX Tracker</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
