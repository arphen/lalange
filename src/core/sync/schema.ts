export const bookSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        title: {
            type: 'string'
        },
        author: {
            type: 'string'
        },
        cover: {
            type: 'string'
        },
        totalWords: {
            type: 'number',
            default: 0
        },
        chapterIds: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    },
    required: ['id', 'title']
} as const;

export const imageSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        bookId: {
            type: 'string',
            maxLength: 100
        },
        filename: {
            type: 'string'
        },
        data: {
            type: 'string' // Base64
        },
        mimeType: {
            type: 'string'
        }
    },
    required: ['id', 'bookId', 'filename', 'data']
} as const;

export const chapterSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        bookId: {
            type: 'string',
            maxLength: 100
        },
        index: {
            type: 'number'
        },
        title: {
            type: 'string'
        },
        status: {
            type: 'string',
            enum: ['pending', 'processing', 'ready', 'error'],
            default: 'pending'
        },
        progress: {
            type: 'number',
            default: 0
        },
        processingSpeed: {
            type: 'number', // WPM
            default: 0
        },
        lastTPM: {
            type: 'number', // Tokens Per Minute
            default: 0
        },
        lastChunkCompletedAt: {
            type: 'number', // Timestamp (ms since epoch)
            default: 0
        },
        content: {
            type: 'array',
            items: {
                type: 'string'
            }
        },
        densities: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        analysisData: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    tokens: { type: 'array', items: { type: 'string' } },
                    surprisals: { type: 'array', items: { type: 'number' } }
                }
            }
        },
        subchapters: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    startWordIndex: { type: 'number' },
                    endWordIndex: { type: 'number' }
                }
            }
        },
        metadata: {
            type: 'object',
            properties: {
                classificationType: { 
                    type: 'string',
                    enum: ['content', 'license', 'toc', 'cover', 'frontmatter', 'backmatter', 'image']
                },
                classificationReason: { type: 'string' },
                licenseInfo: {
                    type: 'object',
                    properties: {
                        publisher: { type: 'string' },
                        text: { type: 'string' }
                    }
                },
                tocEntries: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            href: { type: 'string' }
                        }
                    }
                }
            }
        }
    },
    required: ['id', 'bookId', 'index', 'content'],
    indexes: ['bookId']
} as const;

export const rawFileSchema = {
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            maxLength: 100
        },
        data: {
            type: 'string' // Base64
        }
    },
    required: ['id', 'data']
} as const;

export const readingStateSchema = {
    version: 0,
    primaryKey: 'bookId',
    type: 'object',
    properties: {
        bookId: {
            type: 'string',
            maxLength: 100
        },
        currentChapterId: {
            type: 'string'
        },
        currentWordIndex: {
            type: 'number',
            default: 0
        },
        lastRead: {
            type: 'number',
            default: 0
        },
        highlights: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    chapterId: { type: 'string' },
                    startWordIndex: { type: 'number' },
                    endWordIndex: { type: 'number' },
                    text: { type: 'string' },
                    note: { type: 'string' },
                    createdAt: { type: 'number' }
                }
            }
        },
        // TTS Position - syncs between devices for seamless reading/listening
        ttsPosition: {
            type: 'object',
            properties: {
                chapterId: { type: 'string' },
                sentenceIndex: { type: 'number' },
                wordIndex: { type: 'number' },
                audioTime: { type: 'number' }, // Seconds into audio
                timestamp: { type: 'number' }  // When position was saved
            }
        },
        // TTS Settings - syncs user preferences
        ttsSettings: {
            type: 'object',
            properties: {
                voice: { type: 'string' },
                speed: { type: 'number' }
            }
        }
    },
    required: ['bookId']
} as const;
