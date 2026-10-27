// Package settings 负责设置的 JSON 持久化（appdata）。
package settings

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
)

// Service 设置服务。
type Service struct {
	ctx  context.Context
	path string
	data map[string]any
}

func NewService() *Service {
	s := &Service{data: map[string]any{}}
	if dir, err := os.UserConfigDir(); err == nil {
		s.path = filepath.Join(dir, "GoldenEdit", "settings.json")
	}
	s.load()
	return s
}

func (s *Service) Attach(ctx context.Context) { s.ctx = ctx }

func (s *Service) load() {
	b, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &s.data)
}

// Get 返回全部设置。
func (s *Service) Get() map[string]any { return s.data }

// Set 合并局部设置并持久化。
func (s *Service) Set(patch map[string]any) error {
	for k, v := range patch {
		s.data[k] = v
	}
	if s.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s.data, "", "  ")
	return os.WriteFile(s.path, b, 0644)
}
