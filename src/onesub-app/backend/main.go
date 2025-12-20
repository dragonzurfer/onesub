package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var workspaceRoot = filepath.Join(os.TempDir(), "onesub_workspace")

func main() {
	loadEnvFile()

	if err := os.MkdirAll(workspaceRoot, 0o755); err != nil {
		log.Fatalf("failed to create workspace: %v", err)
	}

	port := os.Getenv("ONESUB_BACKEND_PORT")
	if port == "" {
		port = "8080"
	}

	r := gin.Default()
	r.Use(corsMiddleware())

	r.POST("/api/upload", handleUpload)
	r.GET("/api/media", handleMedia)
	r.POST("/api/render", handleRender)
	r.GET("/api/fonts", handleFonts)

	log.Printf("OneSub backend listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

// --- Upload -----------------------------------------------------------------

func handleUpload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing file"})
		return
	}

	token := fmt.Sprintf("%d", time.Now().UnixNano())
	workspace := filepath.Join(workspaceRoot, token)
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	mediaPath := filepath.Join(workspace, filepath.Base(file.Filename))
	if err := c.SaveUploadedFile(file, mediaPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := runPrepare(mediaPath, workspace); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	transcript, err := loadTranscript(filepath.Join(workspace, "captions.json"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	analysis, err := loadAnalysis(filepath.Join(workspace, "audio_analysis.json"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	segments, duration := mergeSegments(transcript, analysis)

	meta := metadata{
		Token:     token,
		MediaName: file.Filename,
		MediaPath: mediaPath,
	}
	if err := writeJSON(filepath.Join(workspace, "metadata.json"), meta); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	mediaURL := fmt.Sprintf("/api/media?token=%s&file=%s", url.QueryEscape(token), url.QueryEscape(file.Filename))

	c.JSON(http.StatusOK, uploadResponse{
		Token:     token,
		MediaURL:  mediaURL,
		MediaName: file.Filename,
		Duration:  duration,
		Segments:  segments,
	})
}

// --- Media -------------------------------------------------------------------

func handleMedia(c *gin.Context) {
	token := c.Query("token")
	fileName := c.Query("file")
	if token == "" || fileName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token or file"})
		return
	}

	path, err := resolveWorkspaceFile(token, fileName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	c.File(path)
}

// --- Render ------------------------------------------------------------------

type renderRequest struct {
	Token      string            `json:"token"`
	Settings   renderSettings    `json:"settings"`
	Segments   []segmentResponse `json:"segments"`
	Placements []map[string]any  `json:"placements"`
	OutputName string            `json:"outputName"`
}

func handleRender(c *gin.Context) {
	var req renderRequest
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing token"})
		return
	}

	workspace := filepath.Join(workspaceRoot, req.Token)
	meta, err := readMetadata(workspace)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := updateCaptions(workspace, req.Segments); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	configPath, err := writeRenderConfig(workspace, req.Settings, req.Segments, req.Placements)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	outputName := req.OutputName
	if outputName == "" {
		outputName = "rendered.mp4"
	}
	outputPath := filepath.Join(workspace, outputName)

	captionsPath := filepath.Join(workspace, "captions.json")
	analysisPath := filepath.Join(workspace, "audio_analysis.json")

	if err := runRender(meta.MediaPath, captionsPath, analysisPath, configPath, outputPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	renderURL := fmt.Sprintf("/api/media?token=%s&file=%s", url.QueryEscape(req.Token), url.QueryEscape(outputName))
	c.JSON(http.StatusOK, renderResponse{RenderURL: renderURL, Message: "Render complete"})
}

// --- CLI Helpers -------------------------------------------------------------

func runPrepare(mediaPath, outputDir string) error {
	cmd, err := buildCommand("ONESUB_PREPARE_CMD", "onesub.tasks.prepare")
	if err != nil {
		return err
	}
	cmd.Args = append(cmd.Args, mediaPath, "-o", outputDir)
	applyWorkdir(cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("onesub-prepare failed: %w", err)
	}
	return nil
}

func runRender(videoPath, captionsPath, analysisPath, configPath, outputPath string) error {
	cmd, err := buildCommand("ONESUB_RENDER_CMD", "onesub.tasks.render")
	if err != nil {
		return err
	}
	cmd.Args = append(cmd.Args,
		videoPath,
		"--captions", captionsPath,
		"--analysis", analysisPath,
		"--config", configPath,
		"--output", outputPath,
	)
	applyWorkdir(cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("onesub-render failed: %w", err)
	}
	return nil
}

func buildCommand(envKey, module string) (*exec.Cmd, error) {
	candidates := make([][]string, 0, 8)

	if cmdStr, ok := os.LookupEnv(envKey); ok && strings.TrimSpace(cmdStr) != "" {
		parts := strings.Fields(cmdStr)
		if len(parts) > 0 {
			candidates = append(candidates, parts)
		}
	}

	if venv := strings.TrimSpace(os.Getenv("ONESUB_PYTHON_VENV")); venv != "" {
		binNames := []string{"python", "python3"}
		if runtime.GOOS == "windows" {
			binNames = []string{"python.exe", "python3.exe"}
		}
		var found bool
		for _, name := range binNames {
			candidate := filepath.Join(venv, "bin", name)
			if runtime.GOOS == "windows" {
				candidate = filepath.Join(venv, "Scripts", name)
			}
			if _, err := os.Stat(candidate); err == nil {
				found = true
				cmd := exec.Command(candidate, "-m", module)
				applyPythonEnv(cmd)
				log.Printf("executing %s -m %s (via ONESUB_PYTHON_VENV)", candidate, module)
				return cmd, nil
			}
		}
		if !found {
			return nil, fmt.Errorf("python interpreter not found in ONESUB_PYTHON_VENV (%s)", venv)
		}
	}

	binary := strings.ReplaceAll(module, "onesub.tasks.", "onesub-")
	if binary != module {
		candidates = append(candidates, []string{binary})
	}

	candidates = append(candidates, []string{"python3", "-m", module})
	candidates = append(candidates, []string{"python", "-m", module})

	for _, cand := range candidates {
		if len(cand) == 0 {
			continue
		}
		path := cand[0]
		args := cand[1:]
		resolved := path
		if !filepath.IsAbs(path) {
			found, err := exec.LookPath(path)
			if err != nil {
				continue
			}
			resolved = found
		} else {
			if _, err := os.Stat(path); err != nil {
				continue
			}
		}

		cmd := exec.Command(resolved, args...)
		applyPythonEnv(cmd)
		log.Printf("executing %s %s", resolved, strings.Join(args, " "))
		return cmd, nil
	}

	return nil, fmt.Errorf("unable to resolve command for %s", module)
}

// --- Data Structures ---------------------------------------------------------

type uploadResponse struct {
	Token     string            `json:"token"`
	MediaURL  string            `json:"mediaUrl"`
	MediaName string            `json:"mediaName"`
	Duration  float64           `json:"duration"`
	Segments  []segmentResponse `json:"segments"`
}

type segmentResponse struct {
	ID    int            `json:"id"`
	Start float64        `json:"start"`
	End   float64        `json:"end"`
	Text  string         `json:"text"`
	Words []wordResponse `json:"words"`
}

type wordResponse struct {
	ID    int     `json:"id"`
	Text  string  `json:"text"`
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	RMS   float64 `json:"rms"`
}

type transcriptFile struct {
	Segments []struct {
		Index int     `json:"index"`
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
		Words []struct {
			Index int     `json:"index"`
			Text  string  `json:"text"`
			Start float64 `json:"start"`
			End   float64 `json:"end"`
		} `json:"words"`
	} `json:"segments"`
}

type analysisFile struct {
	Words []struct {
		WordIndex int     `json:"word_index"`
		Start     float64 `json:"start"`
		End       float64 `json:"end"`
		RMS       float64 `json:"rms"`
	} `json:"words"`
}

type metadata struct {
	Token     string `json:"token"`
	MediaName string `json:"media_name"`
	MediaPath string `json:"media_path"`
}

type fontBand struct {
	MinSize float64 `json:"minSize"`
	MaxSize float64 `json:"maxSize"`
	Font    string  `json:"font"`
}

type renderSettings struct {
	SizeMin         float64    `json:"sizeMin"`
	SizeMax         float64    `json:"sizeMax"`
	RevealMode      string     `json:"revealMode"`
	Mode            string     `json:"mode"`
	WordsPerCaption int        `json:"wordsPerCaption"`
	IntervalSeconds float64    `json:"intervalSeconds"`
	RollingWindow   int        `json:"rollingWindow"`
	Alignment       int        `json:"alignment"`
	DefaultFont     string     `json:"defaultFont"`
	FontBands       []fontBand `json:"fontBands"`
	Outline         float64    `json:"outline"`
	Shadow          float64    `json:"shadow"`
	LineSpacing     float64    `json:"lineSpacing"`
	LineWordLimits  []int      `json:"lineWordLimits"`
}

type renderResponse struct {
	RenderURL string `json:"renderUrl"`
	Message   string `json:"message"`
}

type fontsResponse struct {
	Fonts []string `json:"fonts"`
}

// --- JSON helpers ------------------------------------------------------------

func loadTranscript(path string) (transcriptFile, error) {
	var tf transcriptFile
	data, err := os.ReadFile(path)
	if err != nil {
		return tf, err
	}
	return tf, json.Unmarshal(data, &tf)
}

func loadAnalysis(path string) (analysisFile, error) {
	var af analysisFile
	data, err := os.ReadFile(path)
	if err != nil {
		return af, err
	}
	return af, json.Unmarshal(data, &af)
}

func readMetadata(workspace string) (metadata, error) {
	var meta metadata
	data, err := os.ReadFile(filepath.Join(workspace, "metadata.json"))
	if err != nil {
		return meta, err
	}
	return meta, json.Unmarshal(data, &meta)
}

func writeJSON(path string, data any) error {
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, bytes, 0o644)
}

// --- Data transformations ----------------------------------------------------

func mergeSegments(tf transcriptFile, af analysisFile) ([]segmentResponse, float64) {
	rmsByIndex := make(map[int]float64, len(af.Words))
	for _, word := range af.Words {
		rmsByIndex[word.WordIndex] = word.RMS
	}

	segments := make([]segmentResponse, 0, len(tf.Segments))
	var duration float64
	for _, seg := range tf.Segments {
		if seg.End > duration {
			duration = seg.End
		}

		words := make([]wordResponse, 0, len(seg.Words))
		for _, word := range seg.Words {
			words = append(words, wordResponse{
				ID:    word.Index,
				Text:  word.Text,
				Start: word.Start,
				End:   word.End,
				RMS:   rmsByIndex[word.Index],
			})
		}

		segments = append(segments, segmentResponse{
			ID:    seg.Index,
			Start: seg.Start,
			End:   seg.End,
			Text:  seg.Text,
			Words: words,
		})
	}

	return segments, duration
}

func updateCaptions(workspace string, segments []segmentResponse) error {
	if len(segments) == 0 {
		return nil
	}

	path := filepath.Join(workspace, "captions.json")
	tf, err := loadTranscript(path)
	if err != nil {
		return err
	}

	textByID := make(map[int]string, len(segments))
	for _, seg := range segments {
		textByID[seg.ID] = seg.Text
	}

	for i, seg := range tf.Segments {
		if text, ok := textByID[seg.Index]; ok {
			tf.Segments[i].Text = text
		}
	}

	return writeJSON(path, tf)
}

func writeRenderConfig(workspace string, settings renderSettings, segments []segmentResponse, placements []map[string]any) (string, error) {
	display := map[string]any{
		"mode":              settings.Mode,
		"words_per_caption": settings.WordsPerCaption,
		"interval_seconds":  settings.IntervalSeconds,
		"rolling_window":    settings.RollingWindow,
		"reveal_mode":       settings.RevealMode,
	}

	if len(settings.LineWordLimits) > 0 {
		display["line_word_limits"] = settings.LineWordLimits
	}

	if len(segments) > 0 {
		windows := make([]map[string]any, 0, len(segments))
		for _, seg := range segments {
			windows = append(windows, map[string]any{
				"start": seg.Start,
				"end":   seg.End,
			})
		}
		windowsPath := filepath.Join(workspace, "manual_windows.json")
		if err := writeJSON(windowsPath, map[string]any{"windows": windows}); err != nil {
			return "", err
		}
		display["windows_path"] = windowsPath
	}

	defaultFont := strings.TrimSpace(settings.DefaultFont)
	if defaultFont == "" {
		defaultFont = "Arial"
	}

	fontBands := []map[string]any{}
	for _, band := range settings.FontBands {
		if band.Font == "" {
			continue
		}
		fontBands = append(fontBands, map[string]any{
			"min_size": band.MinSize,
			"max_size": band.MaxSize,
			"font":     band.Font,
		})
	}

	config := map[string]any{
		"default_font": defaultFont,
		"size_mapping": map[string]any{
			"min": settings.SizeMin,
			"max": settings.SizeMax,
		},
		"display":   display,
		"alignment": settings.Alignment,
	}

	if len(fontBands) > 0 {
		config["font_bands"] = fontBands
	}

	if settings.Outline != 0 {
		config["outline"] = settings.Outline
	}

	if settings.Shadow != 0 {
		config["shadow"] = settings.Shadow
	}

	if settings.LineSpacing != 0 {
		config["line_spacing"] = settings.LineSpacing
	}

	if len(placements) > 0 {
		placementsPath := filepath.Join(workspace, "placements.json")
		if err := writeJSON(placementsPath, map[string]any{"placements": placements}); err != nil {
			return "", err
		}
		config["placements_path"] = placementsPath
	}

	configPath := filepath.Join(workspace, "render_config.json")
	if err := writeJSON(configPath, config); err != nil {
		return "", err
	}
	return configPath, nil
}

// --- Fonts -------------------------------------------------------------------

func handleFonts(c *gin.Context) {
	fonts, err := listAvailableFonts()
	if err != nil {
		log.Printf("failed to enumerate fonts: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enumerate fonts"})
		return
	}
	c.JSON(http.StatusOK, fontsResponse{Fonts: fonts})
}

func listAvailableFonts() ([]string, error) {
	paths := fontSearchPaths()
	seen := map[string]struct{}{}

	for _, root := range paths {
		err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if entry.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			switch ext {
			case ".ttf", ".otf", ".ttc", ".otc":
			default:
				return nil
			}

			name := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
			name = strings.TrimSpace(strings.ReplaceAll(name, "_", " "))
			if name == "" {
				name = entry.Name()
			}
			seen[name] = struct{}{}
			return nil
		})
		if err != nil {
			log.Printf("font scan warning for %s: %v", root, err)
		}
	}

	fonts := make([]string, 0, len(seen))
	for name := range seen {
		fonts = append(fonts, name)
	}
	sort.Strings(fonts)
	return fonts, nil
}

func fontSearchPaths() []string {
	paths := map[string]struct{}{}
	home, _ := os.UserHomeDir()

	add := func(path string) {
		if path == "" {
			return
		}
		if _, ok := paths[path]; ok {
			return
		}
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			paths[path] = struct{}{}
		}
	}

	switch runtime.GOOS {
	case "darwin":
		add("/System/Library/Fonts")
		add("/Library/Fonts")
		if home != "" {
			add(filepath.Join(home, "Library", "Fonts"))
		}
	case "windows":
		winDir := os.Getenv("WINDIR")
		if winDir == "" {
			winDir = "C:\\Windows"
		}
		add(filepath.Join(winDir, "Fonts"))
	case "linux":
		add("/usr/share/fonts")
		add("/usr/local/share/fonts")
		if home != "" {
			add(filepath.Join(home, ".fonts"))
			add(filepath.Join(home, ".local", "share", "fonts"))
		}
	default:
		// best effort cross-platform defaults
		add("/usr/share/fonts")
		add("/usr/local/share/fonts")
		if home != "" {
			add(filepath.Join(home, ".fonts"))
			add(filepath.Join(home, ".local", "share", "fonts"))
		}
	}

	out := make([]string, 0, len(paths))
	for path := range paths {
		out = append(out, path)
	}
	sort.Strings(out)
	return out
}

// --- Misc helpers ------------------------------------------------------------

func resolveWorkspaceFile(token, fileName string) (string, error) {
	workspace := filepath.Join(workspaceRoot, token)
	fullPath := filepath.Join(workspace, fileName)
	if !strings.HasPrefix(fullPath, workspace) {
		return "", errors.New("invalid path")
	}
	return fullPath, nil
}

func normalizeHexColor(value string, fallback string) string {
	sanitize := func(input string) (string, bool) {
		s := strings.TrimSpace(input)
		if s == "" {
			return "", false
		}
		if !strings.HasPrefix(s, "#") {
			s = "#" + s
		}
		if len(s) != 7 {
			return "", false
		}
		for _, ch := range s[1:] {
			if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
				return "", false
			}
		}
		return strings.ToUpper(s), true
	}

	if normalized, ok := sanitize(value); ok {
		return normalized
	}
	if normalized, ok := sanitize(fallback); ok {
		return normalized
	}
	return "#FFFFFF"
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Accept")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

func loadEnvFile() {
	candidates := []string{}
	if custom := strings.TrimSpace(os.Getenv("ONESUB_ENV_FILE")); custom != "" {
		candidates = append(candidates, custom)
	}
	if wd, err := os.Getwd(); err == nil {
		seen := map[string]struct{}{}
		appendCandidate := func(path string) {
			if path == "" {
				return
			}
			if _, ok := seen[path]; ok {
				return
			}
			seen[path] = struct{}{}
			candidates = append(candidates, path)
		}
		appendCandidate(filepath.Join(wd, ".env"))
		appendCandidate(filepath.Join(filepath.Dir(wd), ".env"))
		appendCandidate(filepath.Join(filepath.Dir(filepath.Dir(wd)), ".env"))
	}

	for _, candidate := range candidates {
		if err := applyEnvFile(candidate); err == nil {
			return
		}
	}
}

func applyEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(line[len("export "):])
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

func applyWorkdir(cmd *exec.Cmd) {
	if workdir := os.Getenv("ONESUB_CLI_WORKDIR"); workdir != "" {
		if !filepath.IsAbs(workdir) {
			if abs, err := filepath.Abs(workdir); err == nil {
				workdir = abs
			}
		}
		if info, err := os.Stat(workdir); err == nil && info.IsDir() {
			cmd.Dir = workdir
		} else if err != nil {
			log.Printf("warning: ONESUB_CLI_WORKDIR %q not accessible: %v", workdir, err)
		} else {
			log.Printf("warning: ONESUB_CLI_WORKDIR %q is not a directory", workdir)
		}
	}
}

func applyPythonEnv(cmd *exec.Cmd) {
	envMap := map[string]string{}
	for _, kv := range os.Environ() {
		if idx := strings.IndexByte(kv, '='); idx > 0 {
			envMap[kv[:idx]] = kv[idx+1:]
		}
	}

	if venv := strings.TrimSpace(os.Getenv("ONESUB_PYTHON_VENV")); venv != "" {
		binPath := filepath.Join(venv, "bin")
		if runtime.GOOS == "windows" {
			binPath = filepath.Join(venv, "Scripts")
		}
		if info, err := os.Stat(binPath); err == nil && info.IsDir() {
			envMap["PATH"] = fmt.Sprintf("%s%c%s", binPath, os.PathListSeparator, envMap["PATH"])
		}
	}

	pythonPath := envMap["PYTHONPATH"]
	extraPath := strings.TrimSpace(os.Getenv("ONESUB_PYTHONPATH"))
	if extraPath == "" {
		if workdir := os.Getenv("ONESUB_CLI_WORKDIR"); workdir != "" {
			candidate := filepath.Join(workdir, "src")
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				extraPath = candidate
			}
		}
	}
	if extraPath != "" {
		if pythonPath != "" {
			pythonPath = fmt.Sprintf("%s%c%s", extraPath, os.PathListSeparator, pythonPath)
		} else {
			pythonPath = extraPath
		}
		envMap["PYTHONPATH"] = pythonPath
	}

	envSlice := make([]string, 0, len(envMap))
	for key, value := range envMap {
		envSlice = append(envSlice, fmt.Sprintf("%s=%s", key, value))
	}
	cmd.Env = envSlice
}
