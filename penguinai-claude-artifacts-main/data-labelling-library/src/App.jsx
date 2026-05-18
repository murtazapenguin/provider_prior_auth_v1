import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { useState } from "react";
import { PDFViewer } from "./components/PDFViewer";
import {
  sampleBoundingBoxes,
  samplePDFData,
  SearchResults as sampleSearchResults,
} from "./SampleData";

const theme = createTheme({
  palette: {
    primary: {
      main: "#1976d2",
    },
    secondary: {
      main: "#4caf50",
    },
  },
  typography: {
    fontFamily:
      'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  },
});

function App() {
  const [searchResults, setSearchResults] = useState(null);

  const [annotationData, setAnnotationData] = useState([]);
  const [showAnnotationStats, setShowAnnotationStats] = useState(false);

  const [currentBoundingBoxes, setCurrentBoundingBoxes] =
    useState(sampleBoundingBoxes);

  const handleDocumentChange = (documentName) => {
    console.log("Document changed:", documentName);
  };

  const handlePageChange = (pageNumber) => {
    console.log("Page changed:", pageNumber);
  };

  const handleSearchPerformed = async () => {
    setSearchResults(sampleSearchResults);
  };

  const handleAnnotationsSaved = (savedData) => {
    setCurrentBoundingBoxes(savedData);
    setAnnotationData(savedData);
    setShowAnnotationStats(true);

    setTimeout(() => {
      setShowAnnotationStats(false);
    }, 5000);

    console.log("=== SAVED BOUNDING BOX ANNOTATIONS ===");
    console.log("Total documents with annotations:", savedData.length);
    console.log(JSON.stringify(savedData, null, 2));
    console.log("=== END ANNOTATION DATA ===");
  };

  const pdfUserInterfaces = {
    docNavigation: false,
    zoom: true,
    download: false,
    keyboardShortcuts: true,
    showFilename: false,
    enableToolbar: true,
    enableSearch: true,
  };

  const getAnnotationStats = () => {
    if (!annotationData.length) return null;
    const totalBoxes = annotationData.reduce(
      (total, doc) => total + doc.bbox.length,
      0
    );
    return { totalBoxes, totalDocs: annotationData.length };
  };

  const stats = getAnnotationStats();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ height: "100vh", bgcolor: "#f5f5f5" }}>
        <Box
          sx={{
            height: "100vh",
            bgcolor: "white",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800">PDF Viewer</span>
              </div>

              <div className="flex items-center gap-3">
                {/* Annotation save stats */}
                {showAnnotationStats && stats && (
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600 font-medium">
                        Saved!
                      </span>
                      <span className="text-green-700 text-sm">
                        {stats.totalBoxes} bounding boxes across {stats.totalDocs}{" "}
                        documents
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <PDFViewer
            documentData={samplePDFData}
            boundingBoxes={currentBoundingBoxes}
            searchResults={searchResults}
            userInterfaces={pdfUserInterfaces}
            onDocumentChange={handleDocumentChange}
            onPageChange={handlePageChange}
            onSearchPerformed={handleSearchPerformed}
            setSearchResults={setSearchResults}
            onAnnotationAdd={handleAnnotationsSaved}
          />
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
