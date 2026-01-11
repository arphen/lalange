import { describe, it, expect } from 'vitest';
import { cleanText } from './cleaning';

describe('cleanText - Messy Metadata', () => {
    it('should clean aggressive concatenated metadata', () => {
        // Simulating the user's reported blob
        const text = `
Mostrecentlyupdated:August31,2024Title:TheYellowWallpaperAuthor:CharlottePerkinsGilmanAuthor:CharlottePerkinsGilmanReleasedate:November1,1999[eBook#1952]Mostrecentlyupdated:August31,2024Language:EnglishCredits:AnAnonymousVolunteerandDavidWidger

Chapter 1

The story begins here.
        `;
        
        const result = cleanText(text);
        expect(result.cleanedText).not.toContain('Mostrecentlyupdated');
        expect(result.cleanedText).not.toContain('CharlottePerkinsGilman');
        expect(result.cleanedText).toContain('The story begins here');
    });

    it('should clean standard formatted metadata with the new patterns', () => {
        const text = `
Title: The Yellow Wallpaper
Author: Charlotte Perkins Gilman
Release Date: November 1, 1999 [eBook #1952]
Most recently updated: August 31, 2024
Language: English
Credits: An Anonymous Volunteer

Chapter 1
        `;
        const result = cleanText(text);
        expect(result.cleanedText).not.toContain('Title:');
        expect(result.cleanedText).not.toContain('Most recently updated:');
        expect(result.cleanedText).not.toContain('[eBook #1952]');
        expect(result.cleanedText).toContain('Chapter 1');
    });

    it('should clean concatenated Gutenberg boilerplate with no spaces', () => {
        // The exact text the user reported
        const text = `
mostotherpartsoftheworldatnocostandwithalmostnorestrictionswhatsoever.Youmaycopyit,giveitawayorre-useitunderthetermsoftheProjectGutenbergLicenseincludedwiththisebookoronlineatwww.gutenberg.org.IfyouarenotlocatedintheUnitedStates,youwillhavetocheckthelawsofthecountrywhereyouarelocatedbeforeusingthiseBook.Mostrecentlyupdated:August31,2024Credits:AnAnonymousVolunteerandDavidWidger***STARTOFTHEPROJECTGUTENBERGEBOOKTHEYELLOWWALLPAPER***

The Yellow Wallpaper

By Charlotte Perkins Gilman

It is very seldom that mere ordinary people like John and myself secure ancestral halls for the summer.
        `;
        
        const result = cleanText(text);
        expect(result.cleanedText).not.toContain('mostotherpartsoftheworld');
        expect(result.cleanedText).not.toContain('Youmaycopyit');
        expect(result.cleanedText).not.toContain('ProjectGutenbergLicense');
        expect(result.cleanedText).not.toContain('STARTOFTHEPROJECTGUTENBERG');
        expect(result.cleanedText).not.toContain('AnAnonymousVolunteer');
        expect(result.cleanedText).toContain('It is very seldom');
    });

    it('should clean duplicated concatenated boilerplate', () => {
        const text = `
mostotherpartsoftheworldatnocostandwithalmostnorestrictionswhatsoever.Youmaycopyit,giveitawayorre-useitunderthetermsoftheProjectGutenbergLicenseincludedwiththisebookoronlineatwww.gutenberg.org.IfyouarenotlocatedintheUnitedStates,youwillhavetocheckthelawsofthecountrywhereyouarelocatedbeforeusingthiseBook.Mostrecentlyupdated:August31,2024Credits:AnAnonymousVolunteerandDavidWidgermostotherpartsoftheworldatnocostandwithalmostnorestrictionswhatsoever.Youmaycopyit,giveitawayorre-useitunderthetermsoftheProjectGutenbergLicenseincludedwiththisebookoronlineatwww.gutenberg.org.IfyouarenotlocatedintheUnitedStates,youwillhavetocheckthelawsofthecountrywhereyouarelocatedbeforeusingthiseBook.Mostrecentlyupdated:August31,2024Credits:AnAnonymousVolunteerandDavidWidgerMostrecentlyupdated:August31,2024Credits:AnAnonymousVolunteerandDavidWidger***STARTOFTHEPROJECTGUTENBERGEBOOKT

Actual content here.
        `;
        
        const result = cleanText(text);
        expect(result.cleanedText).not.toContain('mostotherpartsoftheworld');
        expect(result.cleanedText).not.toContain('Youmaycopyit');
        expect(result.cleanedText).not.toContain('ProjectGutenbergLicense');
        expect(result.cleanedText).not.toContain('STARTOFTHEPROJECTGUTENBERG');
        expect(result.cleanedText).toContain('Actual content here');
    });
});
